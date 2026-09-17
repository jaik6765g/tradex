import {
  runSolanaProductionPreflight,
  type SolanaPreflightInput,
} from './solana-production-preflight';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';

const baseNetwork = {
  id: 'solana',
  name: 'Solana',
  protocol: 'SOLANA' as const,
  chainId: SOLANA_CHAIN_ID,
  nativeSymbol: 'SOL',
  usdtContract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  usdtDecimals: 6,
  confirmations: 32,
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

describe('Solana production preflight — new checks', () => {
  it('fails when nonce is not configured', () => {
    const report = runSolanaProductionPreflight(makeInput({ nonceConfigured: false }));
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === 'nonce')?.status).toBe('FAIL');
  });

  it('fails when secret source is none in production', () => {
    const report = runSolanaProductionPreflight(makeInput({ secretSource: 'none' }));
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === 'secret_source')?.status).toBe('FAIL');
  });

  it('warns when secret source is env in production', () => {
    const report = runSolanaProductionPreflight(makeInput({ secretSource: 'env' }));
    expect(report.checks.find((c) => c.key === 'secret_source')?.status).toBe('WARNING');
  });

  it('passes with secret-manager in production', () => {
    const report = runSolanaProductionPreflight(makeInput({ secretSource: 'secret-manager' }));
    expect(report.checks.find((c) => c.key === 'secret_source')?.status).toBe('PASS');
  });

  it('reports E2E flag state without auto-enabling anything', () => {
    const report = runSolanaProductionPreflight(makeInput({ e2eEnabled: true }));
    const e2eCheck = report.checks.find((c) => c.key === 'e2e');
    expect(e2eCheck).toBeDefined();
    expect(e2eCheck!.detail).toContain('E2E=true');
    expect(report.ready).toBe(true);
  });

  it('fails when watcher has no RPC config', () => {
    const report = runSolanaProductionPreflight(
      makeInput({ network: { ...baseNetwork, configured: false, rpcUrls: [] } }),
    );
    expect(report.checks.find((c) => c.key === 'watcher_config')?.status).toBe('FAIL');
  });

  it('fails when treasury equals a deposit address', () => {
    const depositAddr = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
    const report = runSolanaProductionPreflight(
      makeInput({ treasury: depositAddr, depositAddresses: [depositAddr] }),
    );
    expect(report.checks.find((c) => c.key === 'treasury')?.status).toBe('FAIL');
  });

  it('fails when test mnemonic used in production', () => {
    const report = runSolanaProductionPreflight(makeInput({ isDefaultTestMnemonic: true }));
    expect(report.checks.find((c) => c.key === 'mnemonic')?.status).toBe('FAIL');
  });

  it('never exposes secret values in the report', () => {
    const report = runSolanaProductionPreflight(makeInput());
    const json = JSON.stringify(report);
    // No mnemonic phrase, no private key material, no raw secrets.
    expect(json).not.toContain('abandon abandon');
    expect(json).not.toContain('private');
    // The word "secret" may appear in check labels (e.g. "secret_source") but not as a value.
    expect(json).not.toContain('secret-value');
    expect(json).not.toContain('secretKey');
    // No raw base64 key material (32+ chars of base64).
    expect(json).not.toMatch(/"[A-Za-z0-9+/=]{40,}"/);
  });
});