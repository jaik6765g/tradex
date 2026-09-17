import { HttpException, ForbiddenException } from '@nestjs/common';

import { AdminMfaService } from './admin-mfa.service';
import { AdminMfaThrottleService } from './admin-mfa-throttle.service';
import { InMemoryRedis } from './testing/in-memory-redis';

/** Fresh in-memory Redis fake for each throttle instance. */
function makeRedis() {
  return new InMemoryRedis() as never;
}


function makeSupabase(factors: unknown[] | null, error: unknown = null) {
  return {
    auth: {
      admin: {
        mfa: {
          listFactors: async () =>
            factors === null && error
              ? { data: null, error }
              : { data: { factors: factors ?? [] }, error: null },
        },
      },
    },
  } as never;
}

function makeAuditRepo() {
  const saved: Record<string, unknown>[] = [];
  return {
    saved,
    repo: {
      create: (row: Record<string, unknown>) => row,
      save: async (row: Record<string, unknown>) => {
        saved.push(row);
        return row;
      },
    } as never,
  };
}

const verifiedFactor = {
  id: 'factor-1',
  factor_type: 'totp',
  status: 'verified',
  friendly_name: 'TradeX Admin',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const meta = { ip: '127.0.0.1', ua: 'jest' };

describe('AdminMfaService — status, audit, throttle (no secrets)', () => {
  it('unlinked Supabase identity -> not enrolled, not verified, aal1', async () => {
    const svc = new AdminMfaService(
      makeSupabase([]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', undefined, 'aal2');

    expect(status.supabaseLinked).toBe(false);
    expect(status.enrolled).toBe(false);
    expect(status.verified).toBe(false);
    expect(status.factors).toEqual([]);
  });

  it('verified TOTP factor + AAL2 -> enrolled and verified', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal2');

    expect(status.enrolled).toBe(true);
    expect(status.verified).toBe(true);
    expect(status.aal).toBe('aal2');
    expect(status.factors[0]).toMatchObject({ id: 'factor-1', status: 'verified' });
  });

  it('verified factor + AAL1 session -> enrolled but not verified', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal1');

    expect(status.enrolled).toBe(true);
    expect(status.verified).toBe(false);
    expect(status.aal).toBe('aal1');
  });

  it('unverified (pending) factors are counted but not treated as enrolled', async () => {
    const svc = new AdminMfaService(
      makeSupabase([{ ...verifiedFactor, status: 'unverified' }]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal1');

    expect(status.enrolled).toBe(false);
    expect(status.pendingFactors).toBe(1);
  });

  it('non-TOTP factors are filtered out of the safe view', async () => {
    const svc = new AdminMfaService(
      makeSupabase([{ ...verifiedFactor, factor_type: 'phone' }]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal2');

    expect(status.factors).toEqual([]);
    expect(status.enrolled).toBe(false);
  });

  it('Supabase lookup failure -> lookupFailed, never claims enrolled', async () => {
    const svc = new AdminMfaService(
      makeSupabase(null, { message: 'boom' }),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal1');

    expect(status.lookupFailed).toBe(true);
    expect(status.enrolled).toBe(false);
    expect(status.verified).toBe(false);
  });

  it('status payload NEVER contains a TOTP secret / QR / URI / token field', async () => {
    const svc = new AdminMfaService(
      makeSupabase([{ ...verifiedFactor, secret: 'JBSWY3DPEHPK3PXP' }]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );
    const status = await svc.getStatus('u-1', 'auth-1', 'aal2');
    const serialized = JSON.stringify(status).toLowerCase();

    for (const forbidden of [
      'secret',
      'jbswy3dpehpk3pxp',
      'qr_code',
      'qr code',
      'otpauth://',
      'access_token',
      'refresh_token',
      'bearer ',
      'password',
      'recovery',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('AdminMfaService — event audit + brute-force throttle', () => {
  it('records an allow-listed event with safe metadata only', async () => {
    const audit = makeAuditRepo();
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      audit.repo,
      new AdminMfaThrottleService(makeRedis()),
    );

    await svc.recordEvent({
      userId: 'u-1',
      aal: 'aal1',
      event: 'ADMIN_MFA_ENROLL_STARTED',
      factorId: 'factor-2',
      factorCount: 2,
      meta,
    });

    expect(audit.saved).toHaveLength(1);
    const row = audit.saved[0] as Record<string, unknown>;
    expect(row.adminId).toBe('u-1');
    expect(row.action).toBe('ADMIN_MFA_ENROLL_STARTED');
    expect(row.ipAddress).toBe('127.0.0.1');

    const dump = JSON.stringify(row).toLowerCase();
    expect(dump).not.toContain('secret');
    expect(dump).not.toContain('password');
    expect(dump).not.toContain('token');
    expect(dump).not.toContain('code');
  });

  it('rejects an unknown/uncontrolled event with 400', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );

    await expect(
      svc.recordEvent({
        userId: 'u-1',
        aal: 'aal2',
        // Operator-only recovery must never be reachable from the public API.
        event: 'ADMIN_MFA_RECOVERY' as never,
        meta,
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('ADMIN_MFA_CHANGED / ADMIN_MFA_DISABLE require an AAL2 session', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeRedis()),
    );

    for (const event of ['ADMIN_MFA_CHANGED', 'ADMIN_MFA_DISABLE'] as const) {
      await expect(
        svc.recordEvent({ userId: 'u-1', aal: 'aal1', event, meta }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    await expect(
      svc.recordEvent({ userId: 'u-1', aal: 'aal2', event: 'ADMIN_MFA_CHANGED', meta }),
    ).resolves.toMatchObject({ recorded: true });
  });

  it('verification failures throttle the admin, then reset on success', async () => {
    const throttle = new AdminMfaThrottleService(makeRedis());
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      throttle,
    );

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        svc.recordEvent({ userId: 'u-1', aal: 'aal1', event: 'ADMIN_MFA_VERIFY_FAILED', meta }),
      ).resolves.toMatchObject({ recorded: true });
    }

    // 5th failure trips the throttle.
    await expect(
      svc.recordEvent({ userId: 'u-1', aal: 'aal1', event: 'ADMIN_MFA_VERIFY_FAILED', meta }),
    ).rejects.toMatchObject({ status: 429 });

    expect(await throttle.isBlocked('u-1')).toBe(true);

    // The throttle is per-identity and never global.
    expect(await throttle.isBlocked('other-admin')).toBe(false);

    // A successful verification clears the counter for that identity.
    await throttle.registerSuccess('u-1');
    expect(await throttle.isBlocked('u-1')).toBe(false);
  });

  it('verification success clears the failure counter via recordEvent', async () => {
    const throttle = new AdminMfaThrottleService(makeRedis());
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      throttle,
    );

    await svc.recordEvent({ userId: 'u-1', aal: 'aal1', event: 'ADMIN_MFA_VERIFY_FAILED', meta });
    expect((await throttle.snapshot('u-1')).failedAttempts).toBe(1);

    await svc.recordEvent({
      userId: 'u-1',
      aal: 'aal2',
      event: 'ADMIN_MFA_VERIFY_SUCCESS',
      meta,
    });

    expect((await throttle.snapshot('u-1')).failedAttempts).toBe(0);
    expect((await throttle.snapshot('u-1')).blocked).toBe(false);
  });

  it('audit persistence failure never breaks the MFA flow', async () => {
    const failingRepo = {
      create: (row: Record<string, unknown>) => row,
      save: async () => {
        throw new Error('db down');
      },
    } as never;
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      failingRepo,
      new AdminMfaThrottleService(makeRedis()),
    );

    await expect(
      svc.recordEvent({ userId: 'u-1', aal: 'aal1', event: 'ADMIN_MFA_ENROLL_SUCCESS', meta }),
    ).resolves.toMatchObject({ recorded: true });
  });

  it('never logs secrets while processing MFA events', async () => {
    const logged: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    try {
      const svc = new AdminMfaService(
        makeSupabase([verifiedFactor]),
        makeAuditRepo().repo,
        new AdminMfaThrottleService(makeRedis()),
      );
      await svc.recordEvent({
        userId: 'u-1',
        aal: 'aal1',
        event: 'ADMIN_MFA_VERIFY_FAILED',
        result: 'invalid_code',
        meta: { ip: '127.0.0.1', ua: 'jest' },
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }
    const dump = logged.join('\n').toLowerCase();
    expect(dump).not.toContain('jbswy3dpehpk3pxp');
    expect(dump).not.toContain('totp_secret');
  });
});

describe('AdminMfaService — Redis-unavailable FAIL-CLOSED behavior', () => {
  function makeFailingRedis() {
    const fake = new InMemoryRedis();
    fake.failOn.eval = true;
    return fake as never;
  }

  it('VERIFY_FAILED with Redis down -> 503 ADMIN_MFA_SECURITY_UNAVAILABLE (no uncounted attempt)', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeFailingRedis()),
    );

    const err = await svc
      .recordEvent({ userId: 'u-1', aal: 'aal1', event: 'ADMIN_MFA_VERIFY_FAILED', meta })
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'ADMIN_MFA_SECURITY_UNAVAILABLE' });
  });

  it('VERIFY_SUCCESS with Redis down -> 503 (success may not be acknowledged un-reset)', async () => {
    const fake = new InMemoryRedis();
    fake.failOn.del = true; // registerSuccess uses scoped DEL
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(fake as never),
    );

    const err = await svc
      .recordEvent({ userId: 'u-1', aal: 'aal2', event: 'ADMIN_MFA_VERIFY_SUCCESS', meta })
      .catch((e) => e);

    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'ADMIN_MFA_SECURITY_UNAVAILABLE' });
  });

  it('status with Redis down reports throttleUnavailable and blocks (fail-closed display)', async () => {
    const svc = new AdminMfaService(
      makeSupabase([verifiedFactor]),
      makeAuditRepo().repo,
      new AdminMfaThrottleService(makeFailingRedis()),
    );

    const status = await svc.getStatus('u-1', 'auth-1', 'aal1');

    expect(status.throttleUnavailable).toBe(true);
    expect(status.throttle.blocked).toBe(true);
    expect(status.throttle.unavailable).toBe(true);
  });
});