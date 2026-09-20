import { BscWatcherService } from './bsc-watcher.service';

// ============================================================
// BSC WATCHER — STARTUP RESILIENCE (cold-start hardening)
// ============================================================
// Verifies that the watcher no longer blocks/crashes Nest startup:
//   - RPC failure during startup must NOT crash the process
//   - the watcher is not left half-started and retries in the background
//   - success primes the SAME lookback window and starts watching once
//   - duplicate bootstrap calls can never start a second watcher
// ============================================================

const VALID_LOWER_ADDRESS = (nibble: string) =>
  `0x${nibble.repeat(40)}` as const;

function makeConfigService() {
  const values: Record<string, string> = {
    BSC_RPC_URL: 'http://127.0.0.1:8545',
    BSC_RPC_URL_FALLBACK: 'http://127.0.0.1:8546',
    BSC_USDT_ADDRESS: VALID_LOWER_ADDRESS('1'),
    TRADEX_VAULT_ADDRESS: VALID_LOWER_ADDRESS('2'),
    BSC_CHAIN_ID: '56',
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  };
}

function makeService() {
  const queue = { add: jest.fn() };
  const service = new BscWatcherService(
    makeConfigService() as never,
    queue as never,
  );
  // Keep the retry delay tiny so tests never wait 30s.
  (service as unknown as { startupRetryDelayMs: number }).startupRetryDelayMs = 5;
  return { service, queue };
}

describe('BscWatcherService startup resilience', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does NOT crash and does NOT start the watcher when the RPC is unavailable', async () => {
    const { service } = makeService();
    const scanSpy = jest
      .spyOn(service as never, 'scanMissedBlocks' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'getCurrentBlock' as never)
      .mockRejectedValue(new Error('RPC down') as never);

    // Must resolve, never reject (a rejection here used to crash the process).
    await (service as unknown as { initializeWatcher: () => Promise<void> })
      .initializeWatcher();

    expect(scanSpy).not.toHaveBeenCalled();
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    // A background retry is scheduled instead of crashing.
    expect(
      (service as unknown as { startupRetryTimer: unknown }).startupRetryTimer,
    ).not.toBeNull();

    service.onModuleDestroy();
    expect(
      (service as unknown as { startupRetryTimer: unknown }).startupRetryTimer,
    ).toBeNull();
  });

  it('primes the same lookback window, scans once and starts watching exactly once', async () => {
    const { service } = makeService();
    const scanSpy = jest
      .spyOn(service as never, 'scanMissedBlocks' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'getCurrentBlock' as never)
      .mockResolvedValue(1_000 as never);

    const initSpy = jest.spyOn(
      service as never,
      'initializeWatcher' as never,
    );

    service.onApplicationBootstrap();
    service.onApplicationBootstrap(); // duplicate must be ignored

    await (initSpy.mock.results[0]?.value as Promise<void>);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(
      (service as unknown as { lastProcessedBlock: number }).lastProcessedBlock,
    ).toBe(900); // current(1000) - startupLookbackBlocks(100)
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).not.toBeNull();

    service.onModuleDestroy();
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).toBeNull();
  });

  it('survives an unexpected scan rejection without an unhandled rejection', async () => {
    const { service } = makeService();
    jest
      .spyOn(service as never, 'getCurrentBlock' as never)
      .mockResolvedValue(1_000 as never);
    jest
      .spyOn(service as never, 'scanMissedBlocks' as never)
      .mockRejectedValue(new Error('scan blew up') as never);

    await expect(
      (service as unknown as { initializeWatcher: () => Promise<void> })
        .initializeWatcher(),
    ).resolves.toBeUndefined();

    // The watcher still starts so the next interval scan can recover.
    expect(
      (service as unknown as { intervalHandle: unknown }).intervalHandle,
    ).not.toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    service.onModuleDestroy();
  });
});
