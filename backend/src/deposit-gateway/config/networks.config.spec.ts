import {
  NETWORK_DEFINITIONS,
  validateNetworkDefinitions,
  type NetworkDefinition,
} from './networks.config';

describe('networks.config', () => {
  it('defines 9 networks with no duplicate ids or EVM chain ids', () => {
    expect(NETWORK_DEFINITIONS).toHaveLength(9);
    const ids = NETWORK_DEFINITIONS.map((n) => n.id);
    expect(new Set(ids).size).toBe(9);

    const evmChainIds = NETWORK_DEFINITIONS.filter(
      (n) => n.protocol === 'EVM',
    ).map((n) => n.chainId);
    expect(evmChainIds).toHaveLength(7);
    expect(new Set(evmChainIds).size).toBe(7);
  });

  it('validates the built-in definitions cleanly', () => {
    expect(() => validateNetworkDefinitions(NETWORK_DEFINITIONS)).not.toThrow();
  });

  it('rejects duplicate network ids', () => {
    const dup: NetworkDefinition[] = [
      { ...NETWORK_DEFINITIONS[0] },
      { ...NETWORK_DEFINITIONS[0], id: NETWORK_DEFINITIONS[0].id },
    ];
    expect(() => validateNetworkDefinitions(dup)).toThrow(/Duplicate network id/);
  });

  it('rejects an invalid EVM chainId', () => {
    const bad: NetworkDefinition[] = [
      { ...NETWORK_DEFINITIONS[0], chainId: 0 },
    ];
    expect(() => validateNetworkDefinitions(bad)).toThrow(/Invalid chainId/);
  });

  it('rejects an invalid EVM USDT contract address', () => {
    const bad: NetworkDefinition[] = [
      { ...NETWORK_DEFINITIONS[0], usdtContract: '0xZZZ' },
    ];
    expect(() => validateNetworkDefinitions(bad)).toThrow(/Invalid USDT contract/);
  });

  it('gives TRON a stable numeric id and keeps Solana unimplemented', () => {
    const tron = NETWORK_DEFINITIONS.find((n) => n.id === 'tron');
    const solana = NETWORK_DEFINITIONS.find((n) => n.id === 'solana');
    expect(tron?.protocol).toBe('TRON');
    expect(tron?.chainId).toBe(195);
    expect(tron?.usdtContract).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(tron?.envKeys.rpc.length).toBeGreaterThan(0);
    expect(solana?.protocol).toBe('SOLANA');
    expect(solana?.chainId).toBe(501);
    expect(solana?.depositEnabledDefault).toBe(false);
    expect(solana?.usdtContract).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  });

  it('declares RPC + USDT + treasury env keys for every EVM + TRON network', () => {
    for (const n of NETWORK_DEFINITIONS.filter(
      (x) => x.protocol === 'EVM' || x.protocol === 'TRON',
    )) {
      expect(n.envKeys.rpc.length).toBeGreaterThan(0);
      expect(n.envKeys.usdt).toMatch(/_USDT_ADDRESS$/);
      expect(n.envKeys.treasury).toMatch(/_TREASURY_ADDRESS$/);
      expect(n.envKeys.depositEnabled).toMatch(/_DEPOSIT_ENABLED$/);
    }
  });
});
