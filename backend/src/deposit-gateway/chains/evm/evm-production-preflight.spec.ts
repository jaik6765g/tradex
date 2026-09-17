import { runEvmProductionPreflight } from './evm-production-preflight';
import type { NetworkConfig } from '../../networks/network-registry.service';

const POLYGON = {
  chainId: 137,
  usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
};
const ARBITRUM = {
  chainId: 42161,
  usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

function network(
  id: 'polygon' | 'arbitrum',
  overrides: Partial<NetworkConfig> = {},
): NetworkConfig {
  const c = id === 'polygon' ? POLYGON : ARBITRUM;
  return {
    id,
    name: id === 'polygon' ? 'Polygon' : 'Arbitrum',
    protocol: 'EVM',
    chainId: c.chainId,
    nativeSymbol: id === 'polygon' ? 'POL' : 'ETH',
    usdtContract: c.usdt,
    usdtDecimals: 6,
    confirmations: 12,
    explorer: id === 'polygon' ? 'https://polygonscan.com' : 'https://arbiscan.io',
    rpcUrls: ['https://rpc.example'],
    configured: true,
    depositEnabled: true,
    watcherEnabled: true,
    sweepEnabled: true,
    treasuryAddress: '',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeInput(
  id: 'polygon' | 'arbitrum',
  overrides: Record<string, unknown> = {},
): any {
  const c = id === 'polygon' ? POLYGON : ARBITRUM;
  return {
    nodeEnv: 'production',
    networkId: id,
    network: network(id),
    canonical: {
      chainId: c.chainId,
      usdtContract: c.usdt,
      usdtDecimals: 6,
      requiredConfirmations: 12,
    },
    treasury: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    depositAddresses: ['0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a'],
    custodyAvailable: true,
    isTestMnemonic: false,
    sweepGasLimit: '100000',
    secretSource: 'secret-manager',
    ...overrides,
  };
}

describe('Generic EVM production preflight — Polygon + Arbitrum', () => {
  it('passes independently for Polygon and Arbitrum', () => {
    for (const id of ['polygon', 'arbitrum'] as const) {
      const report = runEvmProductionPreflight(makeInput(id));
      expect(report.networkId).toBe(id);
      expect(report.ready).toBe(true);
      expect(report.overall).toBe('PASS');
    }
  });

  it('fails when chainId does not match canonical', () => {
    const report = runEvmProductionPreflight(
      makeInput('polygon', { network: network('polygon', { chainId: 56 }) }),
    );
    expect(report.checks.find((c) => c.key === 'network')?.status).toBe('FAIL');
    expect(report.ready).toBe(false);
  });

  it('rejects a non-canonical USDT contract in production (fake-token guard)', () => {
    const report = runEvmProductionPreflight(
      makeInput('arbitrum', {
        network: network('arbitrum', {
          usdtContract: '0x1111111111111111111111111111111111111111',
        }),
      }),
    );
    expect(report.checks.find((c) => c.key === 'usdt')?.status).toBe('FAIL');
    expect(report.ready).toBe(false);
  });

  it('fails when decimals mismatch / confirmations below minimum / RPC missing', () => {
    const decimals = runEvmProductionPreflight(
      makeInput('polygon', { network: network('polygon', { usdtDecimals: 18 }) }),
    );
    expect(decimals.checks.find((c) => c.key === 'decimals')?.status).toBe('FAIL');

    const conf = runEvmProductionPreflight(
      makeInput('polygon', { network: network('polygon', { confirmations: 5 }) }),
    );
    expect(conf.checks.find((c) => c.key === 'confirmations')?.status).toBe('FAIL');

    const rpc = runEvmProductionPreflight(
      makeInput('polygon', {
        network: network('polygon', { configured: false, rpcUrls: [] }),
      }),
    );
    expect(rpc.checks.find((c) => c.key === 'rpc')?.status).toBe('FAIL');
  });

  it('fails when treasury missing or colliding with a deposit address', () => {
    const missing = runEvmProductionPreflight(makeInput('polygon', { treasury: '' }));
    expect(missing.checks.find((c) => c.key === 'treasury')?.status).toBe('FAIL');

    const collide = runEvmProductionPreflight(
      makeInput('polygon', {
        treasury: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a',
      }),
    );
    expect(collide.checks.find((c) => c.key === 'treasury')?.status).toBe('FAIL');
  });

  it('fails when custody unavailable or test mnemonic in production', () => {
    const noCustody = runEvmProductionPreflight(
      makeInput('polygon', { custodyAvailable: false }),
    );
    expect(noCustody.checks.find((c) => c.key === 'custody')?.status).toBe('FAIL');

    const testMnemonic = runEvmProductionPreflight(
      makeInput('polygon', { isTestMnemonic: true }),
    );
    expect(testMnemonic.checks.find((c) => c.key === 'mnemonic')?.status).toBe('FAIL');
  });

  it('fails when sweep gas missing / flags inconsistent / secret source none', () => {
    const noGas = runEvmProductionPreflight(makeInput('polygon', { sweepGasLimit: '' }));
    expect(noGas.checks.find((c) => c.key === 'sweep_gas')?.status).toBe('FAIL');

    const badFlags = runEvmProductionPreflight(
      makeInput('polygon', {
        network: network('polygon', { configured: false, depositEnabled: true }),
      }),
    );
    expect(badFlags.checks.find((c) => c.key === 'flags')?.status).toBe('FAIL');

    const noSecret = runEvmProductionPreflight(
      makeInput('polygon', { secretSource: 'none' }),
    );
    expect(noSecret.checks.find((c) => c.key === 'secret_source')?.status).toBe('FAIL');
  });

  it('INDEPENDENCE: Polygon failure does not affect Arbitrum report', () => {
    const polygonBroken = runEvmProductionPreflight(
      makeInput('polygon', {
        network: network('polygon', { configured: false, rpcUrls: [] }),
      }),
    );
    const arbitrumOk = runEvmProductionPreflight(makeInput('arbitrum'));
    expect(polygonBroken.ready).toBe(false);
    expect(arbitrumOk.ready).toBe(true);
    expect(arbitrumOk.networkId).toBe('arbitrum');
  });

  it('never exposes secrets in the report', () => {
    const report = runEvmProductionPreflight(makeInput('polygon'));
    const json = JSON.stringify(report);
    expect(json).not.toContain('abandon abandon');
    expect(json).not.toContain('private');
    expect(json).not.toContain('secretKey');
    expect(json).not.toMatch(/"[A-Za-z0-9+/=]{40,}"/);
  });
});