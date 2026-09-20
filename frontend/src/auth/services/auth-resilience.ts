// frontend/src/auth/services/auth-resilience.ts
// ============================================================
// AUTH RESILIENCE HELPERS (pure, dependency-free)
// ============================================================
// Cold-start rules shared by the auth service and the API client:
//
//   - TRANSIENT failures (network error, timeout, aborted request, 5xx)
//     are worth a bounded retry — the backend may still be waking up.
//   - CONFIRMED auth rejections (401/403) and validation errors (4xx) are
//     NEVER retried and must never be treated as "try again".
//
// Keeping these rules pure makes them easy to reason about and impossible
// to accidentally weaken authentication.
// ============================================================

/** HTTP status of an axios-style error; undefined for network/timeout errors. */
export function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const status = (error as { response?: { status?: unknown } }).response
    ?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * True only for failures that a retry can plausibly fix:
 * no HTTP response at all (network error / timeout / abort) or a 5xx.
 */
export function isTransientAuthError(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status === undefined) {
    return true;
  }
  return status >= 500;
}

/** True only for a CONFIRMED authentication rejection (401/403). */
export function isAuthRejectedError(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status === 401 || status === 403;
}

// ------------------------------------------------------------
// SESSION-INVALIDATION DECISION (used by the API client interceptor)
// ------------------------------------------------------------
//
// After a 401, ONE confirmation probe decides the stored session's fate:
//   VALID   -> the token still works (the 401 was transient) => KEEP
//   UNKNOWN -> network/timeout/5xx while probing           => KEEP
//   INVALID -> the probe also returned 401                 => CLEAR
//
// Keeping this as a pure decision makes the "never log users out during a
// cold start" rule explicit and independently testable.
// ------------------------------------------------------------

export type SessionProbeOutcome = 'VALID' | 'INVALID' | 'UNKNOWN';

/** True only when a probe CONFIRMED that the session is invalid. */
export function shouldClearSessionFromProbe(
  outcome: SessionProbeOutcome,
): boolean {
  return outcome === 'INVALID';
}

/** Maps a probe request outcome to the session decision input. */
export function sessionProbeOutcomeFromError(error: unknown): SessionProbeOutcome {
  return httpStatusOf(error) === 401 ? 'INVALID' : 'UNKNOWN';
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TransientRetryOptions {
  /** Extra attempts AFTER the first try (0 = no retry). */
  maxRetries: number;
  /** Base backoff; attempt N waits backoffMs * N. */
  backoffMs: number;
}

/**
 * Runs `task`, retrying ONLY transient failures with a short linear backoff.
 * Bounded by maxRetries, so it can never loop forever. Non-transient errors
 * (401/403/4xx) are rethrown immediately without a second request.
 */
export async function withTransientRetry<T>(
  task: () => Promise<T>,
  options: TransientRetryOptions,
): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= options.maxRetries || !isTransientAuthError(error)) {
        throw error;
      }
      attempt += 1;
      await wait(options.backoffMs * attempt);
    }
  }
}
