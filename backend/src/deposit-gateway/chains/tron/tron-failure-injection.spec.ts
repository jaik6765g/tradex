import { TronWatcherService } from './tron-watcher.service';
import { TronDepositAdapter } from './tron-deposit-adapter';
import {
  computeTronAccounting,
  TronReconciliationService,
} from './tron-reconciliation.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function makeWatcher(queueThrows = false): TronWatcherService {
  const detectionQueue = queueThrows
    ? { getJobCounts: jest.fn(async () => { throw new Error('Redis unavailable'); }) }
    : { getJobCounts: jest.fn(async () => ({ waiting: 2, delayed: 1, failed: 0, active: 1 })) };
  return new TronWatcherService(
    {} as any,
    {} as any,
    {} as any,
    config({}),
    detectionQueue as any,
  );
}

describe('TRON failure injection (no funds, no broadcast)', () => {
  it('reports queue health as unavailable when Redis/queue throws (no crash)', async () => {
    const w = makeWatcher(true);
    const health = await w.queueHealth();
    expect(health).toEqual({ pending: -1, failed: -1, active: -1 });
  });

  it('aggregates waiting+delayed as pending, keeps failed/active visible', async () => {
    const w = makeWatcher(false);
    const health = await w.queueHealth();
    expect(health.pending).toBe(3);
    expect(health.failed).toBe(0);
    expect(health.active).toBe(1);
  });

  it('starts idle with safe default status (not running, no phantom progress)', () => {
    const s = makeWatcher(false).status();
    expect(s.running).toBe(false);
    expect(s.lastScanAt).toBeNull();
    expect(s.lastErrorAt).toBeNull();
    expect(s.lastError).toBeNull();
  });

  it('accounting is pure and idempotent — never mutates balances', () => {
    const input = { balanceSun: 5n, confirmedDepositSun: [10n], completedSweepSun: [5n] };
    const a1 = computeTronAccounting(input);
    const a2 = computeTronAccounting(input);
    expect(a1).toEqual(a2);
    expect(a1.residualSun).toBe(0n);
    // Math stays in bigint; no floats.
    expect(typeof a1.depositedSun).toBe('bigint');
  });

  it('reconciliation is read-only and inert when TRON is not configured', async () => {
    const depositRepo = { find: jest.fn(async () => []), save: jest.fn() } as any;
    const sweepRepo = { find: jest.fn(async () => []), save: jest.fn() } as any;
    const addrSvc = { findActiveByChain: jest.fn(async () => []) } as any;
    const networkRegistry = new NetworkRegistryService(config({}));
    const svc = new TronReconciliationService(depositRepo, sweepRepo, addrSvc, networkRegistry, config({}));

    expect(await svc.reconcile()).toEqual([]);
    expect(depositRepo.save).not.toHaveBeenCalled();
    expect(sweepRepo.save).not.toHaveBeenCalled();
  });

  it('RPC outage surfaces as an observable adapter error (not silent success)', async () => {
    const a = new TronDepositAdapter(
      {
        id: 'tron',
        protocol: 'TRON',
        chainId: 195,
        rpcUrls: ['https://api.trongrid.io'],
        usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        usdtDecimals: 6,
        confirmations: 19,
      } as any,
      (async () => { throw new Error('connection reset'); }) as unknown as typeof fetch,
    );
    await expect(a.getCurrentBlock()).rejects.toThrow();
  });
});