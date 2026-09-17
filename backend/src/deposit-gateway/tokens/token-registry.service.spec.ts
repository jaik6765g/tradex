import { TokenRegistryService } from './token-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('TokenRegistryService', () => {
  it('resolves USDT for EVM (BSC 18dp) and TRON (6dp) from the network registry', () => {
    const registry = new NetworkRegistryService(
      config({ BSC_RPC_URL: 'https://bsc.example' }),
    );
    const svc = new TokenRegistryService(config({}), registry);

    expect(svc.getToken('USDT', 56).contract).toBe(
      '0x55d398326f99059fF775485246999027B3197955',
    );
    expect(svc.getToken('USDT', 56).decimals).toBe(18);

    expect(svc.getToken('USDT', 195).contract).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
    expect(svc.getToken('USDT', 195).decimals).toBe(6);
    expect(svc.getToken('USDT', 195).tdxRate).toBe(100);
  });

  it('rejects unsupported assets and unimplemented networks', () => {
    const registry = new NetworkRegistryService(config({}));
    const svc = new TokenRegistryService(config({}), registry);

    expect(() => svc.getToken('BTC', 56)).toThrow(/Unsupported asset/);
    expect(() => svc.getToken('USDT', 999999)).toThrow(/Unsupported chain/);
    // Solana (501) is now a registered SPL USDT network — it must resolve.
    expect(svc.getToken('USDT', 501).contract).toBe(
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    );
  });
});
