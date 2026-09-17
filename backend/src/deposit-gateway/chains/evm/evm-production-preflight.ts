import { ethers } from 'ethers';

import type { NetworkConfig } from '../../networks/network-registry.service';

// ============================================================
// GENERIC EVM PRODUCTION PREFLIGHT / SAFETY GATE (Phase 7.1)
// ============================================================
// One reusable gate that validates an EVM network INDEPENDENTLY (currently
// used for Polygon + Arbitrum). Canonical facts (chain id, USDT contract,
// decimals, confirmation minimum) are read from NETWORK_DEFINITIONS — the
// single source of truth — never duplicated or invented here.
//
// One network failing must NOT affect the other: evaluate() is per networkId.
// ============================================================

export type EvmCheckStatus = 'PASS' | 'FAIL' | 'WARNING';

export interface EvmReadinessCheck {
  key: string;
  status: EvmCheckStatus;
  detail: string;
}

export interface EvmCanonicalFacts {
  chainId: number;
  usdtContract: string;
  usdtDecimals: number;
  requiredConfirmations: number;
}

export interface EvmPreflightInput {
  nodeEnv: string;
  /** Network being gated (e.g. 'polygon' | 'arbitrum'). */
  networkId: string;
  network: NetworkConfig;
  canonical: EvmCanonicalFacts;
  treasury: string;
  depositAddresses: string[];
  custodyAvailable: boolean;
  isTestMnemonic: boolean;
  sweepGasLimit: string;
  secretSource: 'env' | 'secret-manager' | 'none';
}

export interface EvmReadinessReport {
  networkId: string;
  ready: boolean;
  overall: EvmCheckStatus;
  checks: EvmReadinessCheck[];
}

/** Checksum-valid EVM address (contract address is the token identity). */
function isChecksumAddress(address: string): boolean {
  if (typeof address !== 'string' || !ethers.isAddress(address)) return false;
  try {
    return ethers.getAddress(address) === address;
  } catch {
    return false;
  }
}

export function runEvmProductionPreflight(
  input: EvmPreflightInput,
): EvmReadinessReport {
  const checks: EvmReadinessCheck[] = [];
  const production = input.nodeEnv === 'production';
  const push = (key: string, status: EvmCheckStatus, detail: string) =>
    checks.push({ key, status, detail });

  // 1. Protocol + chain id (must match the canonical definition exactly —
  //    a wrong chainId would sign/verify against the wrong network).
  const networkOk =
    input.network.protocol === 'EVM' &&
    input.network.chainId === input.canonical.chainId;
  push(
    'network',
    networkOk ? 'PASS' : 'FAIL',
    networkOk
      ? `protocol=EVM chainId=${input.canonical.chainId}`
      : `expected EVM/chainId=${input.canonical.chainId}, got ${input.network.protocol}/${input.network.chainId}`,
  );

  // 2. USDT contract — the CONTRACT ADDRESS is the authoritative token identity.
  //    In production it MUST be the canonical USDT contract; an env override
  //    pointing elsewhere (fake token with the same symbol) fails the gate.
  const contractChecksummed = isChecksumAddress(input.network.usdtContract);
  const isCanonicalContract =
    contractChecksummed &&
    input.network.usdtContract.toLowerCase() ===
      input.canonical.usdtContract.toLowerCase();
  if (!contractChecksummed || !input.network.usdtContract) {
    push('usdt', 'FAIL', 'USDT contract missing or not a valid EVM address');
  } else if (production && !isCanonicalContract) {
    push(
      'usdt',
      'FAIL',
      'production must use the canonical USDT contract (env override rejected)',
    );
  } else if (!isCanonicalContract) {
    push('usdt', 'WARNING', 'USDT contract differs from canonical (non-production)');
  } else {
    push('usdt', 'PASS', `canonical USDT ${input.canonical.usdtContract}`);
  }

  // 3. Decimals must match the canonical USDT for this chain.
  const decimalsOk = input.network.usdtDecimals === input.canonical.usdtDecimals;
  push(
    'decimals',
    decimalsOk ? 'PASS' : 'FAIL',
    decimalsOk
      ? `decimals=${input.canonical.usdtDecimals}`
      : `expected decimals=${input.canonical.usdtDecimals}, got ${input.network.usdtDecimals}`,
  );

  // 4. Confirmations: configured requirement must meet the canonical minimum.
  const confOk =
    Number.isInteger(input.network.confirmations) &&
    input.network.confirmations >= input.canonical.requiredConfirmations;
  push(
    'confirmations',
    confOk ? 'PASS' : 'FAIL',
    `required=${input.network.confirmations} (min ${input.canonical.requiredConfirmations})`,
  );

  // 5. RPC configured.
  const rpcOk = input.network.configured && input.network.rpcUrls.length > 0;
  push(
    'rpc',
    rpcOk ? 'PASS' : 'FAIL',
    rpcOk ? 'RPC configured' : 'RPC is not configured',
  );

  // 6. Treasury: valid checksum address, distinct from every deposit address.
  const treasuryValid = isChecksumAddress(input.treasury);
  if (!input.treasury || !treasuryValid) {
    push('treasury', 'FAIL', 'treasury missing/invalid (checksum required)');
  } else if (
    input.depositAddresses.some(
      (a) => a.toLowerCase() === input.treasury.toLowerCase(),
    )
  ) {
    push('treasury', 'FAIL', 'treasury collides with a deposit address');
  } else {
    push('treasury', 'PASS', 'treasury configured + valid + distinct');
  }

  // 7. Custody signer.
  push(
    'custody',
    input.custodyAvailable ? 'PASS' : 'FAIL',
    input.custodyAvailable
      ? 'custody signer available'
      : 'custody signer unavailable',
  );

  // 8. Public test mnemonic must never be used in production.
  if (production && input.isTestMnemonic) {
    push('mnemonic', 'FAIL', 'production must not use the public test mnemonic');
  } else {
    push(
      'mnemonic',
      production ? 'PASS' : 'WARNING',
      production ? 'custody secret acceptable' : 'dev mnemonic accepted',
    );
  }

  // 9. Sweep gas configuration (positive integer).
  const gas = Number(input.sweepGasLimit);
  const gasOk = Number.isFinite(gas) && gas > 0 && Number.isInteger(gas);
  push(
    'sweep_gas',
    gasOk ? 'PASS' : 'FAIL',
    `GAS_SWEEP_GAS_LIMIT=${input.sweepGasLimit || '(missing)'}`,
  );

  // 10. Feature-flag consistency (flags never bypass configuration).
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

  // 11. Production secret source.
  if (production && input.secretSource === 'none') {
    push(
      'secret_source',
      'FAIL',
      'production requires a configured custody secret source',
    );
  } else if (production && input.secretSource === 'env') {
    push(
      'secret_source',
      'WARNING',
      'production uses env-var secret (secret-manager recommended)',
    );
  } else {
    push('secret_source', 'PASS', `secret source: ${input.secretSource}`);
  }

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const overall: EvmCheckStatus = hasFail
    ? 'FAIL'
    : checks.some((c) => c.status === 'WARNING')
      ? 'WARNING'
      : 'PASS';

  return { networkId: input.networkId, ready: !hasFail, overall, checks };
}