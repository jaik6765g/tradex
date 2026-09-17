import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

/** Failed TOTP verifications tolerated per admin identity before blocking. */
export const ADMIN_MFA_THROTTLE_MAX_FAILURES = 5;
/** Window (seconds) during which failed attempts are counted. */
export const ADMIN_MFA_THROTTLE_WINDOW_SECONDS = 300;
/**
 * Shared security namespace. Isolated from all application/business keys and
 * from BullMQ keys; only integer counters live under this prefix.
 */
export const ADMIN_MFA_THROTTLE_KEY_PREFIX =
  'tradex:security:admin-mfa-throttle:';

export interface AdminMfaThrottleState {
  blocked: boolean;
  failedAttempts: number;
  retryAfterSeconds: number;
  /** true when the throttle storage could not be reached (fail-closed). */
  unavailable?: boolean;
}

/** Raised when Redis cannot be read/updated — callers must fail CLOSED. */
export class AdminMfaThrottleUnavailableError extends Error {
  constructor() {
    super('Admin MFA throttle storage is unavailable');
    this.name = 'AdminMfaThrottleUnavailableError';
  }
}

/**
 * Atomic failure registration: INCR + (first attempt only) EXPIRE + TTL read
 * all run inside Redis. Concurrent backend instances can never reset the
 * counter, race the TTL, or bypass the limit because the whole sequence is a
 * single server-side script.
 */
const FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

/** Atomic read of the current counter + TTL (no writes). */
const READ_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return {0, -2}
end
return {tonumber(value), redis.call('TTL', KEYS[1])}
`;

/**
 * Shared (Redis-backed) brute-force throttle for admin TOTP verification.
 *
 * Replaces the previous per-process in-memory Map with state in the EXISTING
 * TradeX Redis (same REDIS_URL / ioredis used by BullMQ), so all backend
 * instances enforce ONE counter per admin identity.
 *
 * Policy (unchanged from the in-memory implementation):
 *   5 failed TOTP verifications within a rolling 300s window → blocked for
 *   the remainder of that window; a successful verification clears the
 *   identity's counter immediately.
 *
 * Keys contain ONLY the normalized authenticated userId — never a TOTP code,
 * secret, otpauth URI, JWT, token or password. Values are integer counters.
 *
 * Failure mode is FAIL-CLOSED: if Redis cannot be read or updated, this
 * service throws `AdminMfaThrottleUnavailableError` instead of silently
 * allowing unlimited verification attempts. (No logging — zero-log surface.)
 */
@Injectable()
export class AdminMfaThrottleService {
  private readonly maxFailedAttempts = ADMIN_MFA_THROTTLE_MAX_FAILURES;
  private readonly windowSeconds = ADMIN_MFA_THROTTLE_WINDOW_SECONDS;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async isBlocked(userId: string): Promise<boolean> {
    return (await this.snapshot(userId)).blocked;
  }

  /** Current throttle state; throws on Redis failure (fail-closed). */
  async snapshot(userId: string): Promise<AdminMfaThrottleState> {
    const key = this.keyFor(userId);
    if (!key) {
      return this.neutralState();
    }

    let result: [number, number];
    try {
      result = (await this.redis.eval(READ_SCRIPT, 1, key)) as [number, number];
    } catch {
      throw new AdminMfaThrottleUnavailableError();
    }

    return this.toState(result[0], result[1]);
  }

  /**
   * Records a failed TOTP attempt atomically and returns the resulting state.
   * Throws on Redis failure (fail-closed).
   */
  async registerFailure(userId: string): Promise<AdminMfaThrottleState> {
    const key = this.keyFor(userId);
    if (!key) {
      return this.neutralState();
    }

    let result: [number, number];
    try {
      result = (await this.redis.eval(
        FAILURE_SCRIPT,
        1,
        key,
        String(this.windowSeconds),
      )) as [number, number];
    } catch {
      throw new AdminMfaThrottleUnavailableError();
    }

    return this.toState(result[0], result[1]);
  }

  /**
   * Clears ONLY this identity's counter after a successful verification
   * (scoped DEL — never a wildcard/prefix delete, so no other user's or other
   * security throttle's state is touched). Throws on Redis failure.
   */
  async registerSuccess(userId: string): Promise<void> {
    const key = this.keyFor(userId);
    if (!key) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch {
      throw new AdminMfaThrottleUnavailableError();
    }
  }

  /**
   * Maps the raw {count, ttl} script result to the public state.
   * A missing/expired key (count 0 or TTL <= 0) starts a fresh window.
   */
  private toState(count: number, ttlSeconds: number): AdminMfaThrottleState {
    if (count <= 0 || ttlSeconds <= 0) {
      return this.neutralState();
    }

    const blocked = count >= this.maxFailedAttempts;

    return {
      blocked,
      failedAttempts: count,
      retryAfterSeconds: blocked ? Math.max(1, ttlSeconds) : 0,
    };
  }

  private neutralState(): AdminMfaThrottleState {
    return { blocked: false, failedAttempts: 0, retryAfterSeconds: 0 };
  }

  /**
   * Key identity = the authenticated TradeX userId ONLY: normalized
   * (trimmed/lowercased), pattern-bounded to `[a-z0-9_-]{1,64}` so no
   * attacker-controlled data can inflate the keyspace. Returns null for an
   * empty/invalid identity (matches the previous service's neutral behavior;
   * real callers always pass `req.user.id` from the verified JWT).
   */
  private keyFor(userId: string): string | null {
    const normalized = String(userId ?? '')
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) {
      return null;
    }

    return `${ADMIN_MFA_THROTTLE_KEY_PREFIX}user:${normalized}`;
  }
}