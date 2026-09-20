import { Logger } from '@nestjs/common';

import { DepositWatcherService } from './deposit-watcher.service';

// ============================================================
// DEPOSIT WATCHER — STARTUP RESILIENCE (cold-start hardening)
// ============================================================
// Verifies the watcher no longer blocks Nest startup:
//   - seeding runs in the background (never in onModuleInit)
//   - a seeding failure is logged and NOT fatal (scan self-heals)
//   - the scan interval starts exactly once, even on repeated bootstrap
// ============================================================

function makeHarness(options: { seedFails?: boolean } = {}) {
  const stateRepo = {
    findOne: options.seedFails
      ? jest.fn().mockRejectedValue(new Error('db unavailable'))
      : jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const addressService = { findActiveByChain: jest.fn().mockResolvedValue([]) };
  const chainRegistry = {
    listChains: () => [{ chainId: 56 }],
    getAdapter: () => ({
      getCurrentBlock: jest.fn().mockResolvedValue(500),
      getTokenAddress: () => `0x${'1'.repeat(40)}`,
      getTransferLogs: jest.fn().mockResolvedValue([]),
    }),
  };
  const configService = {
    get: (_key: string, fallback?: unknown) => fallback,
  };
  const detectionQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new DepositWatcherService(
    stateRepo as never,
    addressService as never,
    chainRegistry as never,
    configService as never,
    detectionQueue as never,
  );

  return { service, stateRepo, configService };
}

describe('DepositWatcherService startup resilience', () => {
  it('seeds state and starts the scan loop exactly once', async () => {
    const { service, stateRepo } = makeHarness();
    const startupSpy = jest.spyOn(service as never, 'startup' as never);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    service.onApplicationBootstrap();
    service.onApplicationBootstrap(); // duplicate must be ignored

    await (startupSpy.mock.results[0]?.value as Promise<void>);

    expect(startupSpy).toHaveBeenCalledTimes(1);
    expect(stateRepo.save).toHaveBeenCalledTimes(1);
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).not.toBeNull();

    service.onModuleDestroy();
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).toBeNull();
    logSpy.mockRestore();
  });

  it('does not crash startup when seeding fails, and still starts the scan loop', async () => {
    const { service } = makeHarness({ seedFails: true });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(
      (service as unknown as { startup: () => Promise<void> }).startup(),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    // The loop still runs: scanChain() re-seeds missing state on next scan.
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).not.toBeNull();

    service.onModuleDestroy();
    warnSpy.mockRestore();
  });

  it('guards against a second timer when bootstrap is invoked again after startup', async () => {
    const { service } = makeHarness();
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    service.onApplicationBootstrap();
    await (service as unknown as { startup: () => Promise<void> }).startup();

    const firstHandle = (
      service as unknown as { intervalHandle: unknown }
    ).intervalHandle;

    service.onApplicationBootstrap(); // guarded by startupStarted
    await (service as unknown as { startup: () => Promise<void> }).startup();

    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).toBe(firstHandle);
    expect(logSpy.mock.calls.filter((c) => c[0] === 'Deposit gateway watcher started')).toHaveLength(1);

    service.onModuleDestroy();
    logSpy.mockRestore();
  });
});
