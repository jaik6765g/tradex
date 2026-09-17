import { NetworkRegistryService } from './network-registry.service';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('NetworkRegistryService', () => {
  it('defines exactly 7 EVM networks with correct chain ids', () => {
    const svc = new NetworkRegistryService(config({}));
    const evm = svc.listNetworks().filter((n) => n.protocol === 'EVM');
    expect(evm.map((n) => [n.id, n.chainId])).toEqual([
      ['bsc', 56],
      ['ethereum', 1],
      ['polygon', 137],
      ['arbitrum', 42161],
      ['base', 8453],
      ['optimism', 10],
      ['avalanche', 43114],
    ]);
  });

  it('has canonical USDT contracts for every EVM network except Base (disabled)', () => {
    const svc = new NetworkRegistryService(config({}));
    const byId = Object.fromEntries(svc.listNetworks().map((n) => [n.id, n]));

    expect(byId.bsc.usdtContract).toBe('0x55d398326f99059fF775485246999027B3197955');
    expect(byId.ethereum.usdtContract).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(byId.polygon.usdtContract).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F');
    expect(byId.arbitrum.usdtContract).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
    expect(byId.optimism.usdtContract).toBe('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58');
    expect(byId.avalanche.usdtContract).toBe('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7');
    // Base: no canonical value committed → stays disabled.
    expect(byId.base.usdtContract).toBe('');
    expect(byId.base.depositEnabled).toBe(false);
  });

  it('enables only BSC when its RPC is configured and no other network is opted in', () => {
    const svc = new NetworkRegistryService(
      config({ BSC_RPC_URL: 'https://bsc.example' }),
    );
    const enabled = svc.listEnabled().map((n) => n.id);
    expect(enabled).toEqual(['bsc']);
  });

  it('marks a network MAINTENANCE when RPC is present but deposits not opted-in', () => {
    const svc = new NetworkRegistryService(
      config({ ETHEREUM_RPC_URL: 'http://127.0.0.1:1' }),
    );
    const eth = svc.getNetwork('ethereum');
    expect(eth.configured).toBe(true);
    expect(eth.watcherEnabled).toBe(true);
    expect(eth.depositEnabled).toBe(false);
    expect(eth.status).toBe('MAINTENANCE');
  });

  it('activates a network when RPC + opt-in are both set', () => {
    const svc = new NetworkRegistryService(
      config({
        ETHEREUM_RPC_URL: 'http://127.0.0.1:1',
        ETHEREUM_DEPOSIT_ENABLED: 'true',
      }),
    );
    const eth = svc.getNetwork('ethereum');
    expect(eth.depositEnabled).toBe(true);
    expect(eth.status).toBe('ACTIVE');
  });

  it('keeps Base disabled even with RPC because the USDT contract is missing', () => {
    const svc = new NetworkRegistryService(
      config({
        BASE_RPC_URL: 'http://127.0.0.1:1',
        BASE_DEPOSIT_ENABLED: 'true',
      }),
    );
    const base = svc.getNetwork('base');
    expect(base.configured).toBe(false);
    expect(base.depositEnabled).toBe(false);
    expect(base.status).toBe('DISABLED');
  });

  it('listWatchable() includes only EVM networks with RPC + contract', () => {
    const svc = new NetworkRegistryService(
      config({
        BSC_RPC_URL: 'https://bsc.example',
        ETHEREUM_RPC_URL: 'http://127.0.0.1:1',
        ETHEREUM_DEPOSIT_ENABLED: 'true',
      }),
    );
    const watchable = svc.listWatchable().map((n) => n.id);
    expect(watchable).toContain('bsc');
    expect(watchable).toContain('ethereum');
    expect(watchable).not.toContain('base');
    expect(watchable).not.toContain('tron');
    expect(watchable).not.toContain('solana');
  });

  it('resolves per-network treasury with a generic fallback', () => {
    const svc = new NetworkRegistryService(
      config({
        DEPOSIT_TREASURY_ADDRESS: '0xFallback',
        BSC_TREASURY_ADDRESS: '0xBscTreasury',
      }),
    );
    expect(svc.getTreasury('bsc')).toBe('0xBscTreasury');
    expect(svc.getTreasury('ethereum')).toBe('0xFallback');
    expect(svc.getTreasury('solana')).toBe('0xFallback');
  });

  it('keeps TRON disabled by default', () => {
    const svc = new NetworkRegistryService(config({}));
    const tron = svc.getNetwork('tron');
    expect(tron.chainId).toBe(195);
    expect(tron.depositEnabled).toBe(false);
    expect(tron.watcherEnabled).toBe(false);
    expect(tron.status).toBe('DISABLED');
  });

  it('enables TRON when RPC + opt-in are configured', () => {
    const svc = new NetworkRegistryService(
      config({
        TRON_RPC_URL: 'https://api.trongrid.io',
        TRON_DEPOSIT_ENABLED: 'true',
      }),
    );
    const tron = svc.getNetwork('tron');
    expect(tron.configured).toBe(true);
    expect(tron.depositEnabled).toBe(true);
    expect(tron.watcherEnabled).toBe(true);
    expect(tron.status).toBe('ACTIVE');
    expect(tron.usdtContract).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  });

  it('keeps configured TRON watchable in MAINTENANCE when not opted in', () => {
    const svc = new NetworkRegistryService(
      config({ TRON_RPC_URL: 'https://api.trongrid.io' }),
    );
    const tron = svc.getNetwork('tron');
    expect(tron.configured).toBe(true);
    expect(tron.watcherEnabled).toBe(true);
    expect(tron.depositEnabled).toBe(false);
    expect(tron.status).toBe('MAINTENANCE');
  });
});
