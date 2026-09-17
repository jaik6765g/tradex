import { SolanaWatcherService } from './solana-watcher.service';
import { SolanaDepositAdapter } from './solana-deposit-adapter';
import type { NetworkConfig } from '../../networks/network-registry.service';
import type { Repository } from 'typeorm';
import type { Queue } from 'bullmq';

function network(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    id: 'solana',
    name: 'Solana',
    protocol: 'SOLANA',
    chainId: 501,
    nativeSymbol: 'SOL',
    usdtContract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    usdtDecimals: 6,
    confirmations: 32,
    explorer: 'https://solscan.io',
    rpcUrls: ['https://api.mainnet-beta.solana.com'],
    configured: true,
    depositEnabled: false,
    watcherEnabled: true,
    sweepEnabled: false,
    treasuryAddress: '',
    status: 'MAINTENANCE',
    ...overrides,
  };
}

const ADDR = 'B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY';
const TOKEN_ACCOUNT = '634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje';

function mockQueue(): Queue {
  const jobs: any[] = [];
  return {
    add: jest.fn(async (name: string, data: any, opts: any) => {
      jobs.push({ name, data, opts });
      return { id: opts?.jobId ?? name } as any;
    }),
    getJobCounts: jest.fn(async () => ({ waiting: 0, delayed: 0, failed: 0, active: 0 })),
  } as unknown as Queue;
}

function mockStateRepo(): Repository<any> {
  let stored: any = null;
  return {
    findOne: jest.fn(async () => stored),
    upsert: jest.fn(async (entity: any) => {
      stored = { ...stored, ...entity };
      return { identifiers: [], generatedMaps: [], raw: [] };
    }),
  } as unknown as Repository<any>;
}

function makeSvc(stateRepo: Repository<any>, queue: Queue, netOverrides: Partial<NetworkConfig> = {}) {
  return new SolanaWatcherService(
    stateRepo as any,
    { findActiveByChain: jest.fn(async () => [{ address: ADDR, userId: 'u1' }]) } as any,
    { getNetwork: () => network(netOverrides) } as any,
    { get: jest.fn(() => '60000') } as any,
    queue,
  );
}

describe('SolanaWatcherService — lifecycle & shutdown', () => {
  it('does not start when network is not configured', () => {
    const svc = makeSvc(mockStateRepo(), mockQueue(), { configured: false, watcherEnabled: false });
    svc.onModuleInit();
    expect(svc.status().running).toBe(false);
  });

  it('does not start when watcher is disabled', () => {
    const svc = makeSvc(mockStateRepo(), mockQueue(), { watcherEnabled: false });
    svc.onModuleInit();
    expect(svc.status().running).toBe(false);
  });

  it('clears interval on destroy', () => {
    const svc = makeSvc(mockStateRepo(), mockQueue());
    svc.onModuleInit();
    expect(svc.status().running).toBe(true);
    svc.onModuleDestroy();
    expect(svc.status().running).toBe(false);
  });
});

describe('SolanaWatcherService — restart recovery & cursor', () => {
  it('resumes from persisted slot cursor with overlap', async () => {
    const stateRepo = mockStateRepo();
    const queue = mockQueue();
    const adapterSpy = jest.spyOn(SolanaDepositAdapter.prototype, 'getSignaturesForAddress')
      .mockResolvedValue([{ signature: 'sig1', slot: 285000050 }]);
    jest.spyOn(SolanaDepositAdapter.prototype, 'getTokenAccountsByOwner')
      .mockResolvedValue([TOKEN_ACCOUNT]);

    const svc = new SolanaWatcherService(
      stateRepo as any,
      { findActiveByChain: jest.fn(async () => [{ address: ADDR, userId: 'u1' }]) } as any,
      { getNetwork: () => network() } as any,
      { get: jest.fn(() => '60000') } as any,
      queue,
    );

    await (svc as any).stateRepo.upsert(
      { chainId: 501, lastProcessedBlock: 285000000, lastProcessedTimestamp: null },
      ['chainId'],
    );

    await (svc as any).scan();

    const callArg = adapterSpy.mock.calls[0][2];
    expect(callArg).toBe(285000100); // persisted (285000000) + SLOT_OVERLAP (100)
    adapterSpy.mockRestore();
  });

  it('advances cursor only when signatures are processed', async () => {
    const stateRepo = mockStateRepo();
    const queue = mockQueue();
    jest.spyOn(SolanaDepositAdapter.prototype, 'getSignaturesForAddress')
      .mockResolvedValue([{ signature: 'sig1', slot: 285000100 }]);
    jest.spyOn(SolanaDepositAdapter.prototype, 'getTokenAccountsByOwner')
      .mockResolvedValue([TOKEN_ACCOUNT]);

    const svc = new SolanaWatcherService(
      stateRepo as any,
      { findActiveByChain: jest.fn(async () => [{ address: ADDR, userId: 'u1' }]) } as any,
      { getNetwork: () => network() } as any,
      { get: jest.fn(() => '60000') } as any,
      queue,
    );

    await (svc as any).stateRepo.upsert(
      { chainId: 501, lastProcessedBlock: 285000000, lastProcessedTimestamp: null },
      ['chainId'],
    );

    await (svc as any).scan();
    expect(svc.status().lastProcessedSlot).toBe(285000100);
  });

  it('uses deterministic BullMQ job IDs for cross-instance dedup', async () => {
    const stateRepo = mockStateRepo();
    const queue = mockQueue();
    jest.spyOn(SolanaDepositAdapter.prototype, 'getSignaturesForAddress')
      .mockResolvedValue([{ signature: 'Abc123Sig', slot: 285000100 }]);
    jest.spyOn(SolanaDepositAdapter.prototype, 'getTokenAccountsByOwner')
      .mockResolvedValue([TOKEN_ACCOUNT]);

    const svc = new SolanaWatcherService(
      stateRepo as any,
      { findActiveByChain: jest.fn(async () => [{ address: ADDR, userId: 'u1' }]) } as any,
      { getNetwork: () => network() } as any,
      { get: jest.fn(() => '60000') } as any,
      queue,
    );

    await (svc as any).scan();

    const addCalls = (queue.add as jest.Mock).mock.calls;
    expect(addCalls[0][2].jobId).toBe('solana-abc123sig');
  });
});

describe('SolanaWatcherService — error isolation & observability', () => {
  it('continues scanning other addresses when one fails', async () => {
    const stateRepo = mockStateRepo();
    const queue = mockQueue();
    const getTokenAccounts = jest.spyOn(SolanaDepositAdapter.prototype, 'getTokenAccountsByOwner');

    getTokenAccounts
      .mockRejectedValueOnce(new Error('RPC timeout'))
      .mockResolvedValueOnce([TOKEN_ACCOUNT]);

    jest.spyOn(SolanaDepositAdapter.prototype, 'getSignaturesForAddress')
      .mockResolvedValue([{ signature: 'sig1', slot: 285000100 }]);

    const svc = new SolanaWatcherService(
      stateRepo as any,
      {
        findActiveByChain: jest.fn(async () => [
          { address: 'addr1', userId: 'u1' },
          { address: 'addr2', userId: 'u2' },
        ]),
      } as any,
      { getNetwork: () => network() } as any,
      { get: jest.fn(() => '60000') } as any,
      queue,
    );

    await (svc as any).scan();

    const addCalls = (queue.add as jest.Mock).mock.calls;
    expect(addCalls.length).toBe(1);
    expect(addCalls[0][1].signature).toBe('sig1');
    getTokenAccounts.mockRestore();
  });

  it('tracks consecutive errors and exposes them', async () => {
    const stateRepo = mockStateRepo();
    const queue = mockQueue();
    jest.spyOn(SolanaDepositAdapter.prototype, 'getTokenAccountsByOwner')
      .mockRejectedValue(new Error('RPC failure'));

    const svc = new SolanaWatcherService(
      stateRepo as any,
      { findActiveByChain: jest.fn(async () => [{ address: ADDR, userId: 'u1' }]) } as any,
      { getNetwork: () => network() } as any,
      { get: jest.fn(() => '60000') } as any,
      queue,
    );

    // First scan: getTokenAccountsByOwner throws → per-address catch → no outer error
    // But the outer try completes without advancing cursor, so consecutiveErrors stays 0.
    // To trigger consecutiveErrors, we need the outer try to throw.
    // Let findActiveByChain throw to trigger the outer catch.
    (svc as any).addressService.findActiveByChain = jest.fn(async () => {
      throw new Error('DB failure');
    });

    await (svc as any).scan();
    await (svc as any).scan();
    expect(svc.status().consecutiveErrors).toBe(2);
    expect(svc.status().lastError).toContain('DB failure');
  });

  it('never exposes secrets in status', () => {
    const svc = makeSvc(mockStateRepo(), mockQueue());
    const json = JSON.stringify(svc.status());
    expect(json).not.toContain('mnemonic');
    expect(json).not.toContain('private');
    expect(json).not.toContain('secret');
  });
});