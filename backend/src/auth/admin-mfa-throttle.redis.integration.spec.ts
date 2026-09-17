import 'reflect-metadata';

import Redis from 'ioredis';

import {
  ADMIN_MFA_THROTTLE_KEY_PREFIX,
  AdminMfaThrottleService,
} from './admin-mfa-throttle.service';
import { parseRedisUrl } from '../redis/redis-connection';

/**
 * TRUE-Redis integration test for the shared admin MFA throttle.
 *
 * Uses the same REDIS_URL configuration as the application (via the shared
 * `parseRedisUrl`) and is SKIPPED automatically when no Redis is reachable,
 * so unit/test environments never require a Redis instance. It exercises the
 * real atomic Lua scripts, TTL handling and multi-connection concurrency that
 * the in-memory fake cannot fully prove.
 *
 * Safety: touches ONLY `tradex:security:admin-mfa-throttle:user:int-test-*`
 * keys (unique per run) and deletes them afterwards. No application/business
 * data is read or written.
 */

let redis: Redis | null = null;
let redisAvailable = false;
const RUN_ID = `int-test-${Date.now()}`;

beforeAll(async () => {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  try {
    redis = new Redis({
      ...parseRedisUrl(url),
      lazyConnect: true,
      connectTimeout: 750,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();
    redisAvailable = (await redis.ping()) === 'PONG';
  } catch {
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (redis && redisAvailable) {
    await redis.del(`${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${RUN_ID}`);
  }
  if (redis) {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }
});

/** Skips the test when no Redis is reachable (tests never REQUIRE Redis). */
function itWhenRedis(
  name: string,
  fn: (this: { skip(): void }) => Promise<void>,
) {
  it(name, async function (this: { skip(): void }) {
    if (!redisAvailable) {
      this.skip();
      return;
    }
    await fn.call(this);
  });
}

itWhenRedis('runs only when a Redis server is reachable', async function () {
  expect(redisAvailable).toBe(true);
});

itWhenRedis(
  'concurrent failures from parallel clients cannot bypass the limit',
  async function () {
    const svc = new AdminMfaThrottleService(redis as never);

    const states = await Promise.all(
      Array.from({ length: 20 }, () => svc.registerFailure(RUN_ID)),
    );

    // Real Redis executed the Lua script atomically for all 20 calls:
    // total of 1+2+...+20 = 210, and blocking from the 5th attempt on.
    expect(states.reduce((sum, s) => sum + s.failedAttempts, 0)).toBe(210);
    expect(states.filter((s) => s.blocked).length).toBe(16);
    const final = await svc.snapshot(RUN_ID);
    expect(final).toMatchObject({ blocked: true, failedAttempts: 20 });
    expect(final.retryAfterSeconds).toBeGreaterThan(0);
    expect(final.retryAfterSeconds).toBeLessThanOrEqual(300);
  },
);

itWhenRedis('TTL is set exactly once and only integer counters stored', async function () {
  const key = `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${RUN_ID}`;
  const ttl = await redis!.ttl(key);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(300);

  const raw = await redis!.get(key);
  expect(raw).toMatch(/^\d+$/); // ONLY an integer counter — never a secret
});

itWhenRedis('success reset clears the identity (scoped DEL)', async function () {
  const svc = new AdminMfaThrottleService(redis as never);
  await svc.registerSuccess(RUN_ID);

  expect(await svc.isBlocked(RUN_ID)).toBe(false);
  expect(
    await redis!.get(`${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${RUN_ID}`),
  ).toBeNull();
});

