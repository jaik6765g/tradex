import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TokenRegistryService } from '../../tokens/token-registry.service';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('Solana network registry + token', () => {
  it('registers Solana (chainId 501) but keeps every flag disabled by default', () => {
    const svc = new NetworkRegistryService(config({}));
    const solana = svc.getNetwork('solana');
    expect(solana.protocol).toBe('SOLANA');
    expect(solana.chainId).toBe(501);
    expect(solana.configured).toBe(false);
    expect(solana.depositEnabled).toBe(false);
    expect(solana.watcherEnabled).toBe(false);
    expect(solana.sweepEnabled).toBe(false);
    expect(solana.status).toBe('DISABLED');
    // Not listed as a deposit-enabled network (no fake address shown to users).
    expect(svc.listEnabled().map((n) => n.id)).not.toContain('solana');
  });

  it('stays MAINTENANCE (watchable optional) with RPC but no deposit opt-in', () => {
    const svc = new NetworkRegistryService(
      config({ SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }),
    );
    const s = svc.getNetwork('solana');
    expect(s.configured).toBe(true);
    expect(s.depositEnabled).toBe(false);
    expect(s.status).toBe('MAINTENANCE');
  });

  it('enables deposits only with RPC + SOLANA_DEPOSIT_ENABLED=true', () => {
    const svc = new NetworkRegistryService(
      config({
        SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
        SOLANA_DEPOSIT_ENABLED: 'true',
      }),
    );
    const s = svc.getNetwork('solana');
    expect(s.depositEnabled).toBe(true);
    expect(s.status).toBe('ACTIVE');
  });

  it('honors SOLANA_WATCHER_ENABLED independently of deposit enablement', () => {
    const svc = new NetworkRegistryService(
      config({
        SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
        SOLANA_WATCHER_ENABLED: 'true',
      }),
    );
    const s = svc.getNetwork('solana');
    expect(s.watcherEnabled).toBe(true);
    expect(s.depositEnabled).toBe(false); // deposits still off
  });

  it('applies the SOLANA_USDT_MINT override and tolerates invalid decimals/confirmations', () => {
    const svc = new NetworkRegistryService(
      config({
        SOLANA_RPC_URL: 'https://x',
        SOLANA_USDT_MINT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        SOLANA_USDT_DECIMALS: 'abc',
        SOLANA_REQUIRED_CONFIRMATIONS: '0',
      }),
    );
    const s = svc.getNetwork('solana');
    expect(s.usdtContract).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(s.usdtDecimals).toBe(6); // falls back to default
    expect(s.confirmations).toBe(32); // falls back to default
  });

  it('resolves the per-network treasury override', () => {
    const svc = new NetworkRegistryService(
      config({
        SOLANA_RPC_URL: 'https://x',
        SOLANA_TREASURY_ADDRESS: 'B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY',
      }),
    );
    expect(svc.getTreasury('solana')).toBe('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY');
  });

  it('exposes SOLANA/USDT/SPL via the token registry', () => {
    const registry = new NetworkRegistryService(
      config({ SOLANA_RPC_URL: 'https://x' }),
    );
    const tokens = new TokenRegistryService(config({}), registry);
    const token = tokens.getToken('USDT', 501);
    expect(token.symbol).toBe('USDT');
    expect(token.decimals).toBe(6);
    expect(token.contract).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  });
});