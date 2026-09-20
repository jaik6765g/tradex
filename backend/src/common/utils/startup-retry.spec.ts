import { runStartupTask, type StartupTaskLogger } from './startup-retry';

type MockLogger = StartupTaskLogger & {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function makeLogger(): MockLogger {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return logger as unknown as MockLogger;
}

// ============================================================
// runStartupTask — bounded, never-throwing startup task runner
// ============================================================

describe('runStartupTask', () => {
  it('runs once and returns true when the task succeeds', async () => {
    const logger = makeLogger();
    const task = jest.fn().mockResolvedValue(undefined);

    await expect(
      runStartupTask({ name: 'T', logger, task, backoffMs: 0 }),
    ).resolves.toBe(true);

    expect(task).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    const logger = makeLogger();
    const task = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);

    await expect(
      runStartupTask({ name: 'T', logger, task, maxAttempts: 3, backoffMs: 0 }),
    ).resolves.toBe(true);

    expect(task).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never throws and gives up after the bounded attempts (no infinite loop)', async () => {
    const logger = makeLogger();
    const task = jest.fn().mockRejectedValue(new Error('redis down'));

    await expect(
      runStartupTask({ name: 'T', logger, task, maxAttempts: 3, backoffMs: 0 }),
    ).resolves.toBe(false);

    expect(task).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('waits the configured backoff between attempts', async () => {
    jest.useFakeTimers();
    try {
      const logger = makeLogger();
      const task = jest
        .fn()
        .mockRejectedValueOnce(new Error('x'))
        .mockResolvedValueOnce(undefined);

      const promise = runStartupTask({
        name: 'T',
        logger,
        task,
        maxAttempts: 2,
        backoffMs: 1_000,
      });

      // First attempt rejects synchronously-ish; the retry waits 1000ms.
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toBe(true);
      expect(task).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats maxAttempts < 1 as a single attempt', async () => {
    const logger = makeLogger();
    const task = jest.fn().mockRejectedValue(new Error('x'));

    await expect(
      runStartupTask({ name: 'T', logger, task, maxAttempts: 0, backoffMs: 0 }),
    ).resolves.toBe(false);

    expect(task).toHaveBeenCalledTimes(1);
  });
});
