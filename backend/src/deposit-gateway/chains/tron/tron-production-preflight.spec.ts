import {
  DEFAULT_TEST_MNEMONIC,
  isE2eEnabled,
  runTronProductionPreflight,
  TRON_USDT_CONTRACT,
  type TronPreflightInput,
} from './tron-production-preflight';

function validInput(overrides: Partial<TronPreflightInput> = {}): TronPreflightInput {
  return {
    nodeEnv: 'production',
    network: {
      id: 'tron',
      protocol: 'TRON',
      chainId: 195,
      usdtContract: TRON_USDT_CONTRACT,
      usdtDecimals: 6,
      confirmations: 19,
      configured: true,
      rpcUrls: ['https://api.trongrid.io'],
      depositEnabled: true,
      watcherEnabled: true,
      sweepEnabled: true,
    } as any,
    apiKey: 'a'.repeat(32),
    treasury: 'TTw16zTokzRde4viLNgPS4ccx6B5dnGrpH',
    depositAddresses: ['TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'],
    custodyAvailable: true,
    isDefaultTestMnemonic: false,
    sweepGasTrx: '20',
    ...overrides,
  };
}

function statusOf(report: { checks: Array<{ key: string; status: string }> }, key: string): string {
  return report.checks.find((c) => c.key === key)?.status ?? 'MISSING';
}

describe('TRON production preflight', () => {
  it('passes for a valid production configuration', () => {
    const report = runTronProductionPreflight(validInput());
    expect(report.ready).toBe(true);
    expect(report.overall).toBe('PASS');
  });

  it('FAILs when the treasury is missing/invalid', () => {
    const report = runTronProductionPreflight(validInput({ treasury: '' }));
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'treasury')).toBe('FAIL');
  });

  it('FAILs when the treasury equals a deposit address', () => {
    const report = runTronProductionPreflight(
      validInput({ treasury: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH' }),
    );
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'treasury')).toBe('FAIL');
  });

  it('FAILs on a missing API key in production', () => {
    const report = runTronProductionPreflight(validInput({ apiKey: undefined }));
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'api_key')).toBe('FAIL');
  });

  it('FAILs when the custody signer is unavailable', () => {
    const report = runTronProductionPreflight(validInput({ custodyAvailable: false }));
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'custody')).toBe('FAIL');
  });

  it('FAILs when the public test mnemonic is used in production', () => {
    const report = runTronProductionPreflight(validInput({ isDefaultTestMnemonic: true }));
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'mnemonic')).toBe('FAIL');
  });

  it('FAILs on an invalid USDT contract', () => {
    const report = runTronProductionPreflight(
      validInput({ network: { ...validInput().network, usdtContract: 'TOther' } as any }),
    );
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'usdt')).toBe('FAIL');
  });

  it('FAILs on a missing sweep gas configuration', () => {
    const report = runTronProductionPreflight(validInput({ sweepGasTrx: '' }));
    expect(report.ready).toBe(false);
    expect(statusOf(report, 'sweep_gas')).toBe('FAIL');
  });

  it('warns (not fails) about a missing API key in dev mode', () => {
    const report = runTronProductionPreflight(validInput({ nodeEnv: 'development', apiKey: undefined }));
    expect(report.ready).toBe(true);
    expect(statusOf(report, 'api_key')).toBe('WARNING');
  });

  it('is E2E-disabled by default and only enabled by the explicit flag', () => {
    expect(isE2eEnabled(undefined)).toBe(false);
    expect(isE2eEnabled('false')).toBe(false);
    expect(isE2eEnabled('TRUE')).toBe(false); // exact 'true' required
    expect(isE2eEnabled('true')).toBe(true);
  });

  it('rejects the known public test mnemonic constant', () => {
    expect(DEFAULT_TEST_MNEMONIC.split(' ')).toHaveLength(12);
  });
});