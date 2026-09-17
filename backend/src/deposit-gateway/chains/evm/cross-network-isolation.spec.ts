import { DepositWatcherService } from '../../watchers/deposit-watcher.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { EvmDepositAdapter } from './evm-deposit-adapter';
import {
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
} from '../../config/networks.config';
import type { ConfigService } from '@nestjs/config';

const POLYGON_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const ARBITRUM_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const POLY_ADDR = '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a';
const ARB_ADDR = '0xBbAaAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3b';

function cfg(env: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

function makeWatcher(adapters: Map<number, any>) {
  const stateRepo: any = {
    findOne: jest.fn(async () => ({ chainId: 0, lastProcessedBlock: 100 })),
    save: jest.fn(async (s: any) => s),
  };
  const addressService: any = {
    findActiveByChain: jest.fn(async (chainId: number) =>
      chainId === POLYGON_CHAIN_ID
        ? [{ address: POLY_ADDR, userId: 'u1' }]
        : [{ address: ARB_ADDR, userId: 'u2' }],
    ),
  };
  const chainRegistry: any = {
    listChains: () => [
      { chainId: POLYGON_CHAIN_ID, nativeSymbol: 'POL' },
      { chainId: ARBITRUM_CHAIN_ID, nativeSymbol: 'ETH' },
    ],
    getAdapter: (chainId: number) => {
      const a = adapters.get(chainId);
      if (!a) throw new Error(`Unsupported chain: ${chainId}`);
      return a;
    },
  };
  const detectionQueue: any = { add: jest.fn(async () => ({})) };
  const svc = new DepositWatcherService(
    stateRepo,
    addressService,
    chainRegistry,
    cfg({ BSC_SCAN_INTERVAL: '60000', BSC_MAX_BLOCKS_PER_SCAN: '10' }),
    detectionQueue,
  );
  return { svc, stateRepo, detectionQueue };
}

describe('CROSS-NETWORK WATCHER ISOLATION (Polygon vs Arbitrum)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('Polygon RPC failure does NOT stop the Arbitrum watcher', async () => {
    const polygonAdapter: any = {
      getChainId: () => POLYGON_CHAIN_ID,
      getTokenAddress: () => POLYGON_USDT,
      getCurrentBlock: jest.fn(async () => {
        throw new Error('Polygon RPC down');
      }),
    };
    const arbitrumAdapter: any = {
      getChainId: () => ARBITRUM_CHAIN_ID,
      getTokenAddress: () => ARBITRUM_USDT,
      getCurrentBlock: jest.fn(async () => 105),
      getTransferLogs: jest.fn(async () => []),
    };
    const { svc, stateRepo } = makeWatcher(
      new Map([
        [POLYGON_CHAIN_ID, polygonAdapter],
        [ARBITRUM_CHAIN_ID, arbitrumAdapter],
      ]),
    );

    await (svc as any).scan();

    const chains = svc.status().chains;
    const polygonStatus = chains.find((c) => c.chainId === POLYGON_CHAIN_ID);
    const arbitrumStatus = chains.find((c) => c.chainId === ARBITRUM_CHAIN_ID);
    expect(polygonStatus?.lastError).toContain('Polygon RPC down');
    expect(arbitrumStatus?.lastError).toBeNull();
    expect(arbitrumStatus?.lastScanAt).not.toBeNull();
    const arbSave = stateRepo.save.mock.calls.find(
      (c: any[]) => c[0].chainId === ARBITRUM_CHAIN_ID,
    );
    expect(arbSave).toBeDefined();
    expect(arbSave![0].lastProcessedBlock).toBe(105);
  });

  it('Arbitrum RPC failure does NOT stop the Polygon watcher', async () => {
    const polygonAdapter: any = {
      getChainId: () => POLYGON_CHAIN_ID,
      getTokenAddress: () => POLYGON_USDT,
      getCurrentBlock: jest.fn(async () => 110),
      getTransferLogs: jest.fn(async () => []),
    };
    const arbitrumAdapter: any = {
      getChainId: () => ARBITRUM_CHAIN_ID,
      getTokenAddress: () => ARBITRUM_USDT,
      getCurrentBlock: jest.fn(async () => {
        throw new Error('Arbitrum RPC down');
      }),
    };
    const { svc, stateRepo } = makeWatcher(
      new Map([
        [POLYGON_CHAIN_ID, polygonAdapter],
        [ARBITRUM_CHAIN_ID, arbitrumAdapter],
      ]),
    );

    await (svc as any).scan();

    const chains = svc.status().chains;
    expect(
      chains.find((c) => c.chainId === ARBITRUM_CHAIN_ID)?.lastError,
    ).toContain('Arbitrum RPC down');
    const polySave = stateRepo.save.mock.calls.find(
      (c: any[]) => c[0].chainId === POLYGON_CHAIN_ID,
    );
    expect(polySave).toBeDefined();
    expect(polySave![0].lastProcessedBlock).toBe(110);
  });

  it('watcher state rows are chain-scoped (no cross-network cursor bleed)', async () => {
    const stateRepo: any = {
      findOne: jest.fn(async (q: any) => ({
        chainId: q.where.chainId,
        lastProcessedBlock: 100,
      })),
      save: jest.fn(async (s: any) => s),
    };
    const addressService: any = { findActiveByChain: jest.fn(async () => []) };
    const chainRegistry: any = {
      listChains: () => [{ chainId: POLYGON_CHAIN_ID, nativeSymbol: 'POL' }],
      getAdapter: () => ({
        getChainId: () => POLYGON_CHAIN_ID,
        getTokenAddress: () => POLYGON_USDT,
        getCurrentBlock: async () => 105,
      }),
    };
    const svc = new DepositWatcherService(
      stateRepo,
      addressService,
      chainRegistry,
      cfg({}),
      { add: jest.fn() } as any,
    );
    await (svc as any).scanChain(POLYGON_CHAIN_ID);
    const saved = stateRepo.save.mock.calls[0][0];
    expect(saved.chainId).toBe(POLYGON_CHAIN_ID);
    expect(saved.lastProcessedBlock).toBe(105);
  });
});

describe('TREASURY + CONFIG ISOLATION', () => {
  it('network-specific treasuries resolve independently (no cross-use)', () => {
    const svc = new NetworkRegistryService(
      cfg({
        POLYGON_RPC_URL: 'https://x',
        POLYGON_TREASURY_ADDRESS: '0x1111111111111111111111111111111111111111',
        ARBITRUM_RPC_URL: 'https://y',
        ARBITRUM_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      }),
    );
    expect(svc.getTreasury('polygon')).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(svc.getTreasury('arbitrum')).toBe(
      '0x2222222222222222222222222222222222222222',
    );
  });

  it('network-specific USDT contracts + confirmations enforced by the adapter', () => {
    const polygonNet = new NetworkRegistryService(
      cfg({ POLYGON_RPC_URL: 'https://x' }),
    ).getNetwork('polygon');
    const arbitrumNet = new NetworkRegistryService(
      cfg({ ARBITRUM_RPC_URL: 'https://y' }),
    ).getNetwork('arbitrum');
    const polygonAdapter = new EvmDepositAdapter(polygonNet);
    const arbitrumAdapter = new EvmDepositAdapter(arbitrumNet);
    expect(polygonAdapter.getTokenAddress('USDT')).toBe(POLYGON_USDT);
    expect(arbitrumAdapter.getTokenAddress('USDT')).toBe(ARBITRUM_USDT);
    expect(polygonAdapter.getRequiredConfirmations()).toBe(12);
    expect(arbitrumAdapter.getRequiredConfirmations()).toBe(12);
  });
});