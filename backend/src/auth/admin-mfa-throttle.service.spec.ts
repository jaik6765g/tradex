import 'reflect-metadata';

import {
  ADMIN_MFA_THROTTLE_KEY_PREFIX,
  ADMIN_MFA_THROTTLE_MAX_FAILURES,
  ADMIN_MFA_THROTTLE_WINDOW_SECONDS,
  AdminMfaThrottleService,
  AdminMfaThrottleUnavailableError,
} from './admin-mfa-throttle.service';
import { InMemoryRedis } from './testing/in-memory-redis';

const USER = 'a1b2c3d4-0000-4000-8000-000000000001';

function makeService(redis: InMemoryRedis) {
  return new AdminMfaThrottleService(redis as never);
}

describe('AdminMfaThrottleService — shared Redis-backed brute-force throttle', () => {
  it('policy is unchanged: 5 failed attempts within a 300s window', () => {
    expect(ADMIN_MFA_THROTTLE_MAX_FAILURES).toBe(5);
    expect(ADMIN_MFA_THROTTLE_WINDOW_SECONDS).toBe(300);
  });

  it('1. first failed attempt creates Redis state under the security namespace', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    const state = await svc.registerFailure(USER);

    expect(state).toMatchObject({ blocked: false, failedAttempts: 1 });
    expect(redis.dumpValues()).toEqual([
      {
        key: `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${USER}`,
        value: '1',
      },
    ]);
  });

  it('2. failed attempts increment atomically (single server-side script)', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    await svc.registerFailure(USER);
    const third = await svc.registerFailure(USER);

    expect(third.failedAttempts).toBe(3);
    // Exactly ONE eval (one atomic script execution) per failure.
    expect(redis.calls.filter((c) => c.command === 'eval')).toHaveLength(3);
  });

  it('3. limit is enforced: blocked at the 5th failure with retry metadata', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    for (let i = 0; i < ADMIN_MFA_THROTTLE_MAX_FAILURES - 1; i += 1) {
      const state = await svc.registerFailure(USER);
      expect(state.blocked).toBe(false);
    }

    const fifth = await svc.registerFailure(USER);
    expect(fifth.blocked).toBe(true);
    expect(fifth.failedAttempts).toBe(5);
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
    expect(await svc.isBlocked(USER)).toBe(true);
  });

  it('4. TTL is applied atomically with the first increment (never re-applied)', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    const key = `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${USER}`;
    expect(redis.rawTtl(key)).toBe(ADMIN_MFA_THROTTLE_WINDOW_SECONDS);

    await svc.registerFailure(USER);
    await svc.registerFailure(USER);

    // TTL preserved from the window start — later failures do not extend it.
    expect(redis.rawTtl(key)).toBe(ADMIN_MFA_THROTTLE_WINDOW_SECONDS);
  });

  it('5. expired throttle state starts a fresh window', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    await svc.registerFailure(USER);
    redis.tick(ADMIN_MFA_THROTTLE_WINDOW_SECONDS + 1);

    const fresh = await svc.registerFailure(USER);
    expect(fresh).toMatchObject({ blocked: false, failedAttempts: 1 });
    expect((await svc.snapshot(USER)).failedAttempts).toBe(1);
  });

  it('6./7. successful verification resets ONLY that identity (scoped DEL)', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    await svc.registerFailure('other-admin-id');

    await svc.registerSuccess(USER);

    expect(await svc.isBlocked(USER)).toBe(false);
    // Another admin's state is untouched (still counted).
    expect((await svc.snapshot('other-admin-id')).failedAttempts).toBe(1);
    // The DEL was scoped to exactly one key — no wildcard/prefix delete.
    const dels = redis.calls.filter((c) => c.command === 'del');
    expect(dels).toHaveLength(1);
    expect(dels[0].args).toEqual([
      `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${USER}`,
    ]);
  });

  it('8. concurrent attempts cannot bypass the limit', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    const states = await Promise.all(
      Array.from({ length: 12 }, () => svc.registerFailure(USER)),
    );

    // Every increment is accounted for; the boundary is enforced exactly.
    expect(states.filter((s) => s.blocked).length).toBe(
      12 - (ADMIN_MFA_THROTTLE_MAX_FAILURES - 1),
    );
    const final = await svc.snapshot(USER);
    expect(final.failedAttempts).toBe(12);
    expect(final.blocked).toBe(true);
  });

  it('9. Redis failure fails CLOSED with a typed unavailable error', async () => {
    const redis = new InMemoryRedis();
    redis.failOn.eval = true;
    const svc = makeService(redis);

    await expect(svc.registerFailure(USER)).rejects.toBeInstanceOf(
      AdminMfaThrottleUnavailableError,
    );
    await expect(svc.snapshot(USER)).rejects.toBeInstanceOf(
      AdminMfaThrottleUnavailableError,
    );

    // DEL failures (success-reset path) also fail closed.
    const redis2 = new InMemoryRedis();
    redis2.failOn.del = true;
    await expect(
      makeService(redis2).registerSuccess(USER),
    ).rejects.toBeInstanceOf(AdminMfaThrottleUnavailableError);
  });

  it('10.-13. nothing secret-like is ever written to Redis', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    await svc.registerFailure(USER);
    await svc.registerSuccess(USER);

    // Every stored value is a bare integer counter.
    for (const { value } of redis.dumpValues()) {
      expect(value).toMatch(/^\d+$/);
    }
    // Every command argument (excluding Lua script bodies and numeric
    // parameters) is a namespaced userId key — never a TOTP code, secret,
    // otpauth URI, JWT or password.
    for (const call of redis.calls) {
      const dataArgs = call.args.filter(
        (a) =>
          !a.includes('redis.call') && !/^\d+$/.test(a) && a !== 'eval' && a,
      );
      for (const arg of dataArgs) {
        const normalized = arg.toLowerCase();
        expect(normalized.startsWith(ADMIN_MFA_THROTTLE_KEY_PREFIX)).toBe(true);
        for (const forbidden of [
          'jbswy3dpehpk3pxp', // sample TOTP secret
          'otpauth://',
          'eyJhb', // JWT header prefix
          'refresh',
          'password',
          '123456', // sample TOTP code
        ]) {
          expect(normalized).not.toContain(forbidden);
        }
      }
    }
  });

  it('14. key identity is normalized and bounded; invalid identities are ignored', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    // Uppercase / padded ids normalize into the same key.
    await svc.registerFailure(`  ${USER.toUpperCase()} `);
    expect(redis.dumpValues()).toEqual([
      { key: `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${USER}`, value: '1' },
    ]);

    // Empty / malformed identities never create keys (neutral state).
    for (const bad of ['', '   ', 'user; DROP TABLE', '../../etc', 'x'.repeat(65)]) {
      const state = await svc.registerFailure(bad);
      expect(state).toMatchObject({ blocked: false, failedAttempts: 0 });
    }
    expect(redis.dumpValues()).toHaveLength(1);

    // Keys stay bounded: prefix + fixed shape.
    expect(redis.dumpValues()[0].key.length).toBeLessThanOrEqual(
      ADMIN_MFA_THROTTLE_KEY_PREFIX.length + 'user:'.length + 64,
    );
  });

  it('15. multiple service instances share the same throttle state', async () => {
    const redis = new InMemoryRedis(); // ONE shared client = one shared state
    const first = makeService(redis);
    const second = makeService(redis);

    await first.registerFailure(USER);
    await second.registerFailure(USER);
    await first.registerFailure(USER);

    expect((await second.snapshot(USER)).failedAttempts).toBe(3);
    await second.registerFailure(USER);
    await second.registerFailure(USER);
    expect(await first.isBlocked(USER)).toBe(true);
  });

  it('16. snapshot is read-only (no DEL, no counter writes)', async () => {
    const redis = new InMemoryRedis();
    const svc = makeService(redis);

    await svc.registerFailure(USER);
    await svc.registerFailure(USER);
    const evalsBefore = redis.calls.filter((c) => c.command === 'eval').length;

    const state = await svc.snapshot(USER);
    expect(state.failedAttempts).toBe(2);

    const evalsAfter = redis.calls.filter((c) => c.command === 'eval');
    expect(evalsAfter.length).toBeGreaterThan(evalsBefore);
    // Only read-script evals were added — the read script never writes.
    expect(
      evalsAfter.slice(evalsBefore).every((c) => !c.args[0].includes('INCR')),
    ).toBe(true);
    expect(redis.calls.some((c) => c.command === 'del')).toBe(false);
  });
});


