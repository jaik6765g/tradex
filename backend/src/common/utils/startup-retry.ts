// backend/src/common/utils/startup-retry.ts
// ============================================================
// DEFERRED STARTUP TASK RUNNER (bounded, never throws)
// ============================================================
//
// Nest awaits EVERY onModuleInit hook before NestFactory.create() returns,
// and the HTTP port only binds afterwards (main.ts -> app.listen()). Any
// startup task that awaits external I/O (Redis, RPC, HTTP) therefore delays
// readiness and — if it rejects — can crash the process into a Render
// restart loop.
//
// Background/deferred tasks use this runner instead: it retries a task a
// bounded number of times with linear backoff and NEVER throws. After the
// final failed attempt it logs an error and gives up, leaving HTTP, queues
// and workers unaffected.
// ============================================================

export interface StartupTaskLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, ...optionalParams: unknown[]): void;
}

export interface StartupRetryOptions {
  /** Human-readable task name used in log lines. */
  name: string;
  logger: StartupTaskLogger;
  task: () => Promise<void>;
  /** Total attempts (first try + retries). Default 5. */
  maxAttempts?: number;
  /** Base backoff; attempt N waits backoffMs * N. Default 5000ms. */
  backoffMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs a non-critical startup task in the background with bounded retries.
 * Returns true when the task completed, false after giving up. Never throws.
 */
export async function runStartupTask(
  options: StartupRetryOptions,
): Promise<boolean> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const backoffMs = Math.max(0, options.backoffMs ?? 5_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await options.task();
      if (attempt > 1) {
        options.logger.log(`${options.name} succeeded on attempt ${attempt}`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        options.logger.error(
          `${options.name} failed after ${maxAttempts} attempts: ${message}`,
        );
        return false;
      }
      options.logger.warn(
        `${options.name} failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs * attempt}ms: ${message}`,
      );
      await sleep(backoffMs * attempt);
    }
  }
  return false;
}
