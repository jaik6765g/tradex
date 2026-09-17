import { isValidTronAddress } from './tron-address';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import type { NetworkConfig } from '../../networks/network-registry.service';

// ============================================================
// TRON PRODUCTION PREFLIGHT / SAFETY GATE
// ============================================================
// Reusable PASS / FAIL / WARNING checks for TRON production readiness.
// Never returns/prints configured secrets (mnemonic, private key, API key) —
// only booleans + safe details.

export const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRON_USDT_DECIMALS = 6;
export const TRON_REQUIRED_CONFIRMATIONS_MIN = 19;

/** The well-known public test mnemonic — NEVER accepted for production. */
export const DEFAULT_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARNING';

export interface ReadinessCheck {
  key: string;
  status: CheckStatus;
  detail: string;
}

export interface TronPreflightInput {
  nodeEnv: string;
  network: NetworkConfig;
  apiKey?: string;
  treasury: string;
  depositAddresses: string[];
  /** True when a real custody signer (self-custody/tronweb) is available. */
  custodyAvailable: boolean;
  /** True when the configured mnemonic is the well-known public test phrase. */
  isDefaultTestMnemonic: boolean;
  sweepGasTrx: string;
  sweepEnabledGlobal?: boolean;
}

export interface TronReadinessReport {
  ready: boolean;
  overall: CheckStatus;
  checks: ReadinessCheck[];
}

/** E2E must be explicitly enabled; it is OFF by default (never implicit). */
export function isE2eEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function runTronProductionPreflight(
  input: TronPreflightInput,
): TronReadinessReport {
  const checks: ReadinessCheck[] = [];
  const production = input.nodeEnv === 'production';

  const push = (key: string, status: CheckStatus, detail: string) =>
    checks.push({ key, status, detail });

  // 1. Network
  const networkOk = input.network.protocol === 'TRON' && input.network.chainId === TRON_CHAIN_ID;
  push(
    'network',
    networkOk ? 'PASS' : 'FAIL',
    networkOk
      ? `protocol=TRON chainId=${TRON_CHAIN_ID}`
      : `expected TRON/chainId=${TRON_CHAIN_ID}, got ${input.network.protocol}/${input.network.chainId}`,
  );

  // 2. USDT contract + decimals
  const contractOk =
    input.network.usdtContract === TRON_USDT_CONTRACT &&
    input.network.usdtDecimals === TRON_USDT_DECIMALS;
  push(
    'usdt',
    contractOk ? 'PASS' : 'FAIL',
    contractOk
      ? `TRC20 USDT ${TRON_USDT_CONTRACT} decimals=${TRON_USDT_DECIMALS}`
      : `expected ${TRON_USDT_CONTRACT}/d${TRON_USDT_DECIMALS}, got ${input.network.usdtContract}/d${input.network.usdtDecimals}`,
  );

  // 3. Confirmations
  const confOk = input.network.confirmations >= TRON_REQUIRED_CONFIRMATIONS_MIN;
  push(
    'confirmations',
    confOk ? 'PASS' : 'FAIL',
    `required=${input.network.confirmations} (min ${TRON_REQUIRED_CONFIRMATIONS_MIN})`,
  );

  // 4. RPC configured
  const rpcOk = input.network.configured && input.network.rpcUrls.length > 0;
  push(
    'rpc',
    rpcOk ? 'PASS' : 'FAIL',
    rpcOk ? 'TRON RPC (TRON_RPC_URL) configured' : 'TRON RPC is not configured',
  );

  // 5. API key (required in production)
  const apiKeyOk = Boolean(input.apiKey && input.apiKey.length >= 16);
  if (production) {
    push(
      'api_key',
      apiKeyOk ? 'PASS' : 'FAIL',
      apiKeyOk ? 'TRON_GRID_API_KEY configured' : 'TRON_GRID_API_KEY is required in production',
    );
  } else {
    push('api_key', apiKeyOk ? 'PASS' : 'WARNING', 'TRON_GRID_API_KEY not set (dev mode)');
  }

  // 6. Treasury valid + not equal to any deposit address
  const treasuryValid = isValidTronAddress(input.treasury);
  if (!input.treasury || !treasuryValid) {
    push(
      'treasury',
      production ? 'FAIL' : 'FAIL',
      'TRON treasury missing/invalid (TRON_TREASURY_ADDRESS)',
    );
  } else if (input.depositAddresses.some((a) => a === input.treasury)) {
    push('treasury', 'FAIL', 'TRON treasury collides with a deposit address');
  } else {
    push('treasury', 'PASS', 'TRON treasury configured + valid + distinct');
  }

  // 7. Custody signer
  push(
    'custody',
    input.custodyAvailable ? 'PASS' : 'FAIL',
    input.custodyAvailable ? 'TRON custody signer available' : 'TRON custody signer unavailable',
  );

  // 8. Reject default test mnemonic in production
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

  // 9. Sweep gas
  const gas = Number(input.sweepGasTrx);
  const gasOk = Number.isFinite(gas) && gas > 0;
  push('sweep_gas', gasOk ? 'PASS' : 'FAIL', `TRON_SWEEP_GAS_TRX=${input.sweepGasTrx || '(missing)'}`);

  // 10. Flag consistency
  const flagOk =
    (!input.network.depositEnabled || input.network.configured) &&
    (!input.network.watcherEnabled || input.network.configured) &&
    (!input.network.sweepEnabled || (input.network.configured && treasuryValid));
  push(
    'flags',
    flagOk ? 'PASS' : 'FAIL',
    `deposit=${input.network.depositEnabled} watcher=${input.network.watcherEnabled} sweep=${input.network.sweepEnabled} configured=${input.network.configured}`,
  );

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const overall: CheckStatus = hasFail ? 'FAIL' : checks.some((c) => c.status === 'WARNING') ? 'WARNING' : 'PASS';
  return { ready: !hasFail, overall, checks };
}