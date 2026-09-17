import { EvmDepositAdapter } from './evm-deposit-adapter';
import type { NetworkConfig } from '../../networks/network-registry.service';

function network(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    id: 'ethereum',
    name: 'Ethereum',
    protocol: 'EVM',
    chainId: 1,
    nativeSymbol: 'ETH',
    usdtContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdtDecimals: 6,
    confirmations: 12,
    explorer: 'https://etherscan.io',
    rpcUrls: ['http://127.0.0.1:1'],
    configured: true,
    depositEnabled: true,
    watcherEnabled: true,
    sweepEnabled: false,
    treasuryAddress: '',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('EvmDepositAdapter', () => {
  it('exposes chain id, native symbol, token and decimals from config', () => {
    const a = new EvmDepositAdapter(network());
    expect(a.getChainId()).toBe(1);
    expect(a.getNativeSymbol()).toBe('ETH');
    expect(a.getTokenAddress('USDT')).toBe(
      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    );
    expect(a.getTokenDecimals('USDT')).toBe(6);
    expect(a.getRequiredConfirmations()).toBe(12);
  });

  it('handles 18-decimal BSC-style config correctly', () => {
    const a = new EvmDepositAdapter(
      network({
        id: 'bsc',
        chainId: 56,
        nativeSymbol: 'BNB',
        usdtContract: '0x55d398326f99059fF775485246999027B3197955',
        usdtDecimals: 18,
        confirmations: 15,
      }),
    );
    expect(a.getChainId()).toBe(56);
    expect(a.getTokenDecimals('USDT')).toBe(18);
    expect(a.getRequiredConfirmations()).toBe(15);
  });

  it('validates checksummed EVM addresses and rejects malformed input', () => {
    const a = new EvmDepositAdapter(network());
    expect(a.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')).toBe(
      true,
    );
    // Lowercase hex is a valid EVM address (ethers re-checksums it).
    expect(a.validateAddress('0x9858effd232b4033e47d90003d41ec34ecaeda94')).toBe(
      true,
    );
    // Structurally invalid values are rejected.
    expect(a.validateAddress('not-an-address')).toBe(false);
    expect(a.validateAddress('0x1234')).toBe(false);
    expect(a.validateAddress('')).toBe(false);
  });

  it('throws at construction when no RPC is configured for a network', () => {
    expect(() => new EvmDepositAdapter(network({ rpcUrls: [] }))).toThrow(
      /No RPC configured/,
    );
  });
});
