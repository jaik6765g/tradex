import { isValidSolanaAddress } from './solana-address';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import type { NetworkConfig } from '../../networks/network-registry.service';

// ============================================================
// SOLANA PRODUCTION PREFLIGHT / SAFETY GATE
// ============================================================

export const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const SOLANA_USDT_DECIMALS = 6;
export const SOLANA_REQUIRED_CONFIRMATIONS_MIN = 32;

/** The well-known public test mnemonic — NEVER accepted for production. */
export const DEFAULT_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING';

export interface ReadinessCheck {
  key: string;
  status: CheckStatus;
  detail: string;
}

export interface SolanaPreflightInput {
  nodeEnv: string;
  network: NetworkConfig;
  treasury: string;
  depositAddresses: string[];
  custodyAvailable: boolean;
  isDefaultTestMnemonic: boolean;
  sweepGasLamports: string;
  nonceConfigured: boolean;
  e2eEnabled: boolean;
  secretSource: 'env' | 'secret-manager' | 'none';
}

export interface SolanaReadinessReport {
  ready: boolean;
  overall: CheckStatus;
  checks: ReadinessCheck[];
}

export function isE2eEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function runSolanaProductionPreflight(
  input: SolanaPreflightInput,
): SolanaReadinessReport {
  const checks: ReadinessCheck[] = [];
  const production = input.nodeEnv === 'production';

  const push = (key: string, status: CheckStatus, detail: string) =>
    checks.push({ key, status, detail });

  // 1. Network
  const networkOk =
    input.network.protocol === 'SOLANA' &&
    input.network.chainId === SOLANA_CHAIN_ID;
  push(
    'network',
    networkOk ? 'PASS' : 'FAIL',
    networkOk
      ? `protocol=SOLANA chainId=${SOLANA_CHAIN_ID}`
      : `expected SOLANA/chainId=${SOLANA_CHAIN_ID}, got ${input.network.protocol}/${input.network.chainId}`,
  );

  // 2. USDT mint + decimals
  const mintOk =
    input.network.usdtContract === SOLANA_USDT_MINT &&
    input.network.usdtDecimals === SOLANA_USDT_DECIMALS;
  push(
    'usdt',
    mintOk ? 'PASS' : 'FAIL',
    mintOk
      ? `SPL USDT ${SOLANA_USDT_MINT} decimals=${SOLANA_USDT_DECIMALS}`
      : `expected ${SOLANA_USDT_MINT}/d${SOLANA_USDT_DECIMALS}, got ${input.network.usdtContract}/d${input.network.usdtDecimals}`,
  );

  // 3. Confirmations
  const confOk = input.network.confirmations >= SOLANA_REQUIRED_CONFIRMATIONS_MIN;
  push(
    'confirmations',
    confOk ? 'PASS' : 'FAIL',
    `required=${input.network.confirmations} (min ${SOLANA_REQUIRED_CONFIRMATIONS_MIN})`,
  );

  // 4. RPC configured
  const rpcOk = input.network.configured && input.network.rpcUrls.length > 0;
  push(
    'rpc',
    rpcOk ? 'PASS' : 'FAIL',
    rpcOk ? 'SOLANA RPC configured' : 'SOLANA RPC is not configured',
  );

  // 5. Treasury valid + distinct
  const treasuryValid = isValidSolanaAddress(input.treasury);
  if (!input.treasury || !treasuryValid) {
    push(
      'treasury',
      'FAIL',
      'SOLANA treasury missing/invalid (SOLANA_TREASURY_ADDRESS)',
    );
  } else if (input.depositAddresses.some((a) => a === input.treasury)) {
    push('treasury', 'FAIL', 'SOLANA treasury collides with a deposit address');
  } else {
    push('treasury', 'PASS', 'SOLANA treasury configured + valid + distinct');
  }

  // 6. Custody signer
  push(
    'custody',
    input.custodyAvailable ? 'PASS' : 'FAIL',
    input.custodyAvailable
      ? 'SOLANA custody signer available'
      : 'SOLANA custody signer unavailable',
  );

  // 7. Reject default test mnemonic in production
  if (production && input.isDefaultTestMnemonic) {
    push(
      'mnemonic',
      'FAIL',
      'production must not use the public test mnemonic; configure a secure secret',
    );
  } else {
    push(
      'mnemonic',
      production ? 'PASS' : 'WARNING',
      production ? 'custody secret source acceptable' : 'dev mode mnemonic accepted',
    );
  }

  // 8. Sweep gas
  const gas = Number(input.sweepGasLamports);
  const gasOk = Number.isFinite(gas) && gas > 0;
  push(
    'sweep_gas',
    gasOk ? 'PASS' : 'FAIL',
    `SOLANA_SWEEP_GAS_LAMPORTS=${input.sweepGasLamports || '(missing)'}`,
  );

  // 9. Flag consistency
  const flagOk =
    (!input.network.depositEnabled || input.network.configured) &&
    (!input.network.watcherEnabled || input.network.configured) &&
    (!input.network.sweepEnabled ||
      (input.network.configured && treasuryValid));
  push(
    'flags',
    flagOk ? 'PASS' : 'FAIL',
    `deposit=${input.network.depositEnabled} watcher=${input.network.watcherEnabled} sweep=${input.network.sweepEnabled} configured=${input.network.configured}`,
  );

  // 10. Durable nonce configuration (required for sweep)
  // The nonce account is derived from the custody authority PDA, but a
  // production deployment must explicitly confirm the nonce account exists
  // on-chain. Without this, sweeps cannot be crash-recovered.
  const nonceOk = input.nonceConfigured;
  push(
    'nonce',
    nonceOk ? 'PASS' : 'FAIL',
    nonceOk
      ? 'durable nonce account configured'
      : 'SOLANA_NONCE_ACCOUNT not configured — sweeps cannot be crash-recovered',
  );

  // 11. Production secret source
  // Production must use a dedicated secret manager or secure env — never
  // the default test mnemonic and never an unconfigured source.
  if (production && input.secretSource === 'none') {
    push('secret_source', 'FAIL', 'production requires a configured secret source');
  } else if (production && input.secretSource === 'env') {
    push('secret_source', 'WARNING', 'production uses env-var secret (secret-manager recommended)');
  } else {
    push('secret_source', 'PASS', `secret source: ${input.secretSource}`);
  }

  // 12. E2E flag — visible but never auto-enables anything
  push(
    'e2e',
    'PASS',
    `E2E=${input.e2eEnabled} (informational only — does not enable deposits/sweeps)`,
  );

  // 13. Watcher + sweep config presence (independent of enablement)
  push(
    'watcher_config',
    input.network.configured ? 'PASS' : 'FAIL',
    input.network.configured ? 'watcher can run when enabled' : 'watcher has no RPC config',
  );

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const overall: CheckStatus = hasFail
    ? 'FAIL'
    : checks.some((c) => c.status === 'WARNING')
      ? 'WARNING'
      : 'PASS';

  return { ready: !hasFail, overall, checks };
}
