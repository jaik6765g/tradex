import { Logger } from '@nestjs/common';

import { LottoSettlementScheduler } from './lotto-settlement.scheduler';

// ============================================================
// BULLMQ SCHEDULER — STARTUP RESILIENCE (cold-start hardening)
// ============================================================
// Verifies scheduler registration can no longer block or crash startup:
//   - onApplicationBootstrap returns synchronously (no awaited Redis I/O)
//   - a Redis failure is retried a BOUNDED number of times, then given up
//   - success registers once and never retries
//   - the config kill-switch still disables registration entirely
// ============================================================

function makeScheduler(options: { enabled?: string } = {}) {
  const upsertJobScheduler = jest.fn();
  const queue = { upsertJobScheduler };
  const configService = {
    get: (key: string, fallback?: unknown) =>
      key === 'LOTTO_EXPIRY_SETTLEMENT_ENABLED'
        ? (options.enabled ?? 'true')
        : fallback,
  };
  const scheduler = new LottoSettlementScheduler(
    queue as never,
    configService as never,
  );
  return { scheduler, upsertJobScheduler };
}

describe('LottoSettlementScheduler startup resilience', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    jest.useRealTimers();
  });

  it('registers the scheduler once and never retries on success', async () => {
    jest.useFakeTimers();
    const { scheduler, upsertJobScheduler } = makeScheduler();
    upsertJobScheduler.mockResolvedValue(undefined);

    expect(() => scheduler.onApplicationBootstrap()).not.toThrow();
    await jest.advanceTimersByTimeAsync(0);

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);

    // No further attempts even after well beyond the retry window.
    await jest.advanceTimersByTimeAsync(120_000);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('retries Redis failures a bounded number of times and never throws (no infinite loop)', async () => {
    jest.useFakeTimers();
    const { scheduler, upsertJobScheduler } = makeScheduler();
    upsertJobScheduler.mockRejectedValue(new Error('redis down'));

    expect(() => scheduler.onApplicationBootstrap()).not.toThrow();

    // Flush the first attempt + all bounded retries (5 attempts, 5s linear backoff).
    await jest.advanceTimersByTimeAsync(120_000);

    expect(upsertJobScheduler).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalled();

    // Still bounded after more time.
    await jest.advanceTimersByTimeAsync(600_000);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(5);
  });

  it('honours the config kill-switch without touching Redis', () => {
    const { scheduler, upsertJobScheduler } = makeScheduler({ enabled: 'false' });

    scheduler.onApplicationBootstrap();

    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });
});
