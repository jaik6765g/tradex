import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TokenRegistryService } from '../../tokens/token-registry.service';
import {
  NETWORK_DEFINITIONS,
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
} from '../../config/networks.config';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('Polygon + Arbitrum network configuration (Phase 7.1)', () => {
  it('registers canonical chain IDs, protocol and native symbols', () => {
    const svc = new NetworkRegistryService(config({}));
    const polygon = svc.getNetwork('polygon');
    const arbitrum = svc.getNetwork('arbitrum');
    expect(polygon.protocol).toBe('EVM');
    expect(polygon.chainId).toBe(POLYGON_CHAIN_ID);
    expect(polygon.chainId).toBe(137);
    expect(polygon.nativeSymbol).toBe('POL');
    expect(arbitrum.protocol).toBe('EVM');
    expect(arbitrum.chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(arbitrum.chainId).toBe(42161);
    expect(arbitrum.nativeSymbol).toBe('ETH');
  });

  it('preserves canonical USDT contracts + decimals (never invented)', () => {
    const polygonDef = NETWORK_DEFINITIONS.find((d) => d.id === 'polygon');
    const arbitrumDef = NETWORK_DEFINITIONS.find((d) => d.id === 'arbitrum');
    expect(polygonDef!.usdtContract).toBe(
      '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    );
    expect(polygonDef!.usdtDecimals).toBe(6);
    expect(arbitrumDef!.usdtContract).toBe(
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    );
    expect(arbitrumDef!.usdtDecimals).toBe(6);
    // USDT contracts must differ across the two networks (identity per chain).
    expect(polygonDef!.usdtContract).not.toBe(arbitrumDef!.usdtContract);
  });

  it('keeps canonical confirmations + explorer + env keys', () => {
    const polygonDef = NETWORK_DEFINITIONS.find((d) => d.id === 'polygon');
    const arbitrumDef = NETWORK_DEFINITIONS.find((d) => d.id === 'arbitrum');
    expect(polygonDef!.requiredConfirmations).toBe(12);
    expect(polygonDef!.explorer).toBe('https://polygonscan.com');
    expect(polygonDef!.envKeys.rpc[0]).toBe('POLYGON_RPC_URL');
    expect(polygonDef!.envKeys.usdt).toBe('POLYGON_USDT_ADDRESS');
    expect(polygonDef!.envKeys.confirmations).toBe(
      'POLYGON_REQUIRED_CONFIRMATIONS',
    );
    expect(polygonDef!.envKeys.treasury).toBe('POLYGON_TREASURY_ADDRESS');
    expect(arbitrumDef!.requiredConfirmations).toBe(12);
    expect(arbitrumDef!.explorer).toBe('https://arbiscan.io');
    expect(arbitrumDef!.envKeys.rpc[0]).toBe('ARBITRUM_RPC_URL');
    expect(arbitrumDef!.envKeys.treasury).toBe('ARBITRUM_TREASURY_ADDRESS');
  });

  it('stays DISABLED by default (no accidental activation)', () => {
    const svc = new NetworkRegistryService(config({}));
    for (const id of ['polygon', 'arbitrum']) {
      const n = svc.getNetwork(id);
      expect(n.configured).toBe(false);
      expect(n.depositEnabled).toBe(false);
      expect(n.watcherEnabled).toBe(false);
      expect(n.sweepEnabled).toBe(false);
      expect(n.status).toBe('DISABLED');
      expect(svc.listEnabled().map((x) => x.id)).not.toContain(id);
    }
  });

  it('independently gates each network (Polygon on does not enable Arbitrum)', () => {
    const svc = new NetworkRegistryService(
      config({
        POLYGON_RPC_URL: 'https://polygon-rpc.example',
        POLYGON_DEPOSIT_ENABLED: 'true',
      }),
    );
    const polygon = svc.getNetwork('polygon');
    const arbitrum = svc.getNetwork('arbitrum');
    expect(polygon.status).toBe('ACTIVE');
    expect(polygon.depositEnabled).toBe(true);
    expect(arbitrum.status).toBe('DISABLED');
    expect(arbitrum.depositEnabled).toBe(false);
  });

  it('MAINTENANCE: RPC present but deposits not opted in', () => {
    const svc = new NetworkRegistryService(
      config({ ARBITRUM_RPC_URL: 'https://arb-rpc.example' }),
    );
    const arbitrum = svc.getNetwork('arbitrum');
    expect(arbitrum.status).toBe('MAINTENANCE');
    expect(arbitrum.configured).toBe(true);
    expect(arbitrum.depositEnabled).toBe(false);
    expect(arbitrum.watcherEnabled).toBe(true); // existing addresses keep working
  });

  it('token registry resolves per-network USDT and rejects fake assets', () => {
    const svc = new NetworkRegistryService(config({}));
    const tokens = new TokenRegistryService(config({}), svc);
    const t = tokens.getToken('USDT', ARBITRUM_CHAIN_ID);
    expect(t.contract).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
    expect(t.decimals).toBe(6);
    expect(() => tokens.getToken('FAKE', POLYGON_CHAIN_ID)).toThrow(
      /Unsupported asset/,
    );
    expect(() => tokens.getToken('USDT', 999999)).toThrow(/Unsupported chain/);
  });

  it('honors per-network confirmation env overrides with safe fallback', () => {
    const svc = new NetworkRegistryService(
      config({
        POLYGON_RPC_URL: 'https://polygon-rpc.example',
        POLYGON_REQUIRED_CONFIRMATIONS: '0', // invalid → falls back to default
        ARBITRUM_RPC_URL: 'https://arb-rpc.example',
        ARBITRUM_REQUIRED_CONFIRMATIONS: '20', // valid override
      }),
    );
    expect(svc.getNetwork('polygon').confirmations).toBe(12);
    expect(svc.getNetwork('arbitrum').confirmations).toBe(20);
  });

  it('applies USDT env override per network without cross-contamination', () => {
    const svc = new NetworkRegistryService(
      config({
        POLYGON_RPC_URL: 'https://x',
        POLYGON_USDT_ADDRESS: '0x1111111111111111111111111111111111111111',
      }),
    );
    expect(svc.getNetwork('polygon').usdtContract).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    // Arbitrum unaffected (still canonical).
    expect(svc.getNetwork('arbitrum').usdtContract).toBe(
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    );
  });
});