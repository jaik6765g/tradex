import {
  runSolanaProductionPreflight,
  SOLANA_USDT_MINT,
  SOLANA_USDT_DECIMALS,
  SOLANA_REQUIRED_CONFIRMATIONS_MIN,
  isE2eEnabled,
  type SolanaPreflightInput,
} from './solana-production-preflight';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';

const baseNetwork = {
  id: 'solana',
  name: 'Solana',
  protocol: 'SOLANA' as const,
  chainId: SOLANA_CHAIN_ID,
  nativeSymbol: 'SOL',
  usdtContract: SOLANA_USDT_MINT,
  usdtDecimals: SOLANA_USDT_DECIMALS,
  confirmations: SOLANA_REQUIRED_CONFIRMATIONS_MIN,
  explorer: 'https://solscan.io',
  rpcUrls: ['https://api.mainnet-beta.solana.com'],
  configured: true,
  depositEnabled: true,
  watcherEnabled: true,
  sweepEnabled: true,
  treasuryAddress: '',
  status: 'ACTIVE' as const,
};

function makeInput(overrides: Partial<SolanaPreflightInput> = {}): SolanaPreflightInput {
  const base: SolanaPreflightInput = {
    nodeEnv: 'production',
    network: baseNetwork,
    treasury: '6cSw2JwfuEU8jSp3gvNM5Nwa6zjPhohsagmQm1FVKWyU',
    depositAddresses: ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
    custodyAvailable: true,
    isDefaultTestMnemonic: false,
    sweepGasLamports: '5000',
    nonceConfigured: true,
    e2eEnabled: false,
    secretSource: 'secret-manager',
  };
  return Object.assign(base, overrides);
}

describe('Solana production preflight', () => {
  it('passes with valid production configuration', () => {
    const report = runSolanaProductionPreflight(makeInput());
    expect(report.ready).toBe(true);
    expect(report.overall).toBe('PASS');
  });

  it('fails when USDT mint is invalid', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ network: { ...baseNetwork, usdtContract: 'INVALID_MINT' } }),
    );
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === 'usdt')?.status).toBe('FAIL');
  });

  it('fails when USDT decimals mismatch', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ network: { ...baseNetwork, usdtDecimals: 18 } }),
    );
    expect(report.checks.find((c) => c.key === 'usdt')?.status).toBe('FAIL');
  });

  it('fails when confirmations below minimum', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ network: { ...baseNetwork, confirmations: 10 } }),
    );
    expect(report.checks.find((c) => c.key === 'confirmations')?.status).toBe('FAIL');
  });

  it('fails when RPC not configured', () => {
    const report = runSolanaProductionPreflight(
      makeInput({
        network: { ...baseNetwork, configured: false, rpcUrls: [] },
      }),
    );
    expect(report.checks.find((c) => c.key === 'rpc')?.status).toBe('FAIL');
  });

  it('fails when treasury is missing/invalid', () => {
    const report = runSolanaProductionPreflight(makeInput({ treasury: '' }));
    expect(report.checks.find((c) => c.key === 'treasury')?.status).toBe('FAIL');
  });

  it('fails when treasury equals a deposit address', () => {
    const depositAddr = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
    const report = runSolanaProductionPreflight(
      makeInput({
        treasury: depositAddr,
        depositAddresses: [depositAddr],
      }),
    );
    expect(report.checks.find((c) => c.key === 'treasury')?.status).toBe('FAIL');
  });

  it('fails when custody signer unavailable', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ custodyAvailable: false }),
    );
    expect(report.checks.find((c) => c.key === 'custody')?.status).toBe('FAIL');
  });

  it('fails when test mnemonic used in production', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ isDefaultTestMnemonic: true }),
    );
    expect(report.checks.find((c) => c.key === 'mnemonic')?.status).toBe('FAIL');
  });

  it('fails when sweep gas not configured', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ sweepGasLamports: '' }),
    );
    expect(report.checks.find((c) => c.key === 'sweep_gas')?.status).toBe('FAIL');
  });

  it('reports WARNING for test mnemonic in dev mode', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ nodeEnv: 'development', isDefaultTestMnemonic: true }),
    );
    expect(report.checks.find((c) => c.key === 'mnemonic')?.status).toBe('WARNING');
  });

  it('validates isE2eEnabled flag', () => {
    expect(isE2eEnabled('true')).toBe(true);
    expect(isE2eEnabled('false')).toBe(false);
    expect(isE2eEnabled(undefined)).toBe(false);
  });
});
