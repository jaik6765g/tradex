import { ethers } from 'ethers';

// ============================================================
// CENTRALIZED DEPOSIT NETWORK CONFIGURATION
// ============================================================
// This file is the SINGLE SOURCE OF TRUTH for every deposit network.
//
// - Public network facts (id, name, chainId, USDT contract, decimals,
//   confirmations, explorer) live here.
// - RPC endpoints, treasury addresses and custody secrets stay in environment
//   variables / secret manager. This file only holds the ENV-VAR NAMES used to
//   resolve them — never the values.
//
// Adding or changing an EVM network normally requires ONLY editing this file
// (plus providing the required environment values). The Generic EVM engine,
// watcher, credit, ledger, sweep and reconciliation consume NetworkConfig and
// require no code change.
// ============================================================

export type NetworkProtocol = 'EVM' | 'TRON' | 'SOLANA';

export interface NetworkEnvKeys {
  /** Env var names (in priority order) used to resolve RPC endpoints. */
  rpc: string[];
  /** Optional env var override for the canonical USDT contract. */
  usdt?: string;
  /** Optional env var override for USDT decimals. */
  decimals?: string;
  /** Optional env var override for required confirmations. */
  confirmations?: string;
  /** Optional env var override for explorer URL. */
  explorer?: string;
  /** Env var used to opt a network in for deposits. */
  depositEnabled?: string;
  /** Optional env override for the watcher flag (defaults to watcherEnabledDefault). */
  watcherEnabled?: string;
  /** Optional env override for the sweep flag (defaults to sweepEnabledDefault). */
  sweepEnabled?: string;
  /** Per-network treasury env var. */
  treasury?: string;
}

export interface NetworkDefinition {
  id: string;
  name: string;
  protocol: NetworkProtocol;
  /** Stable numeric network id: EVM chain id, or SLIP-44 coin type for non-EVM (null = not implemented). */
  chainId: number | null;
  nativeSymbol: string;
  /**
   * Canonical USDT contract (EVM/TRC-20) or SPL mint.
   * EMPTY STRING = not configured yet (the network stays DISABLED). We do not
   * invent production addresses.
   */
  usdtContract: string;
  usdtDecimals: number;
  requiredConfirmations: number;
  explorer: string;
  envKeys: NetworkEnvKeys;
  /** Enable deposits automatically when RPC + USDT are configured. */
  depositEnabledDefault: boolean;
  /** Whether the watcher should run when RPC + USDT are configured. */
  watcherEnabledDefault: boolean;
  /** Whether sweep may run (gated by the global DEPOSIT_SWEEP_ENABLED env). */
  sweepEnabledDefault: boolean;
}

/** Generic fallback treasury (used when a per-network treasury is not set). */
export const GENERIC_TREASURY_ENV_KEY = 'DEPOSIT_TREASURY_ADDRESS';
/** Global switch that gates sweep for every network. */
export const SWEEP_ENABLED_ENV_KEY = 'DEPOSIT_SWEEP_ENABLED';
/** TRON's stable numeric network id (SLIP-44 coin type). */
export const TRON_CHAIN_ID = 195;
/** Solana's stable numeric network id (SLIP-44 coin type). */
export const SOLANA_CHAIN_ID = 501;
/** Polygon's stable EVM chain id (canonical, used as the gateway chain_id). */
export const POLYGON_CHAIN_ID = 137;
/** Arbitrum One's stable EVM chain id (canonical, used as the gateway chain_id). */
export const ARBITRUM_CHAIN_ID = 42161;

function networkEnvKeys(id: string): NetworkEnvKeys {
  const p = id.toUpperCase();
  return {
    // Keep the existing convention (matches BSC_RPC_URL / BSC_RPC_URL_FALLBACK).
    rpc: [`${p}_RPC_URL`, `${p}_RPC_URL_FALLBACK`, `${p}_RPC_URL_FALLBACK_2`],
    usdt: `${p}_USDT_ADDRESS`,
    decimals: `${p}_USDT_DECIMALS`,
    confirmations: `${p}_REQUIRED_CONFIRMATIONS`,
    explorer: `${p}_EXPLORER`,
    depositEnabled: `${p}_DEPOSIT_ENABLED`,
    treasury: `${p}_TREASURY_ADDRESS`,
  };
}
export const NETWORK_DEFINITIONS: NetworkDefinition[] = [
  {
    id: 'bsc',
    name: 'BNB Smart Chain',
    protocol: 'EVM',
    chainId: 56,
    nativeSymbol: 'BNB',
    usdtContract: '0x55d398326f99059fF775485246999027B3197955',
    usdtDecimals: 18,
    requiredConfirmations: 15,
    explorer: 'https://bscscan.com',
    envKeys: networkEnvKeys('bsc'),
    depositEnabledDefault: true,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    protocol: 'EVM',
    chainId: 1,
    nativeSymbol: 'ETH',
    usdtContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://etherscan.io',
    envKeys: networkEnvKeys('ethereum'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'polygon',
    name: 'Polygon',
    protocol: 'EVM',
    chainId: POLYGON_CHAIN_ID,
    nativeSymbol: 'POL',
    usdtContract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://polygonscan.com',
    envKeys: networkEnvKeys('polygon'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    protocol: 'EVM',
    chainId: ARBITRUM_CHAIN_ID,
    nativeSymbol: 'ETH',
    usdtContract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://arbiscan.io',
    envKeys: networkEnvKeys('arbitrum'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'base',
    name: 'Base',
    protocol: 'EVM',
    chainId: 8453,
    nativeSymbol: 'ETH',
    // Canonical Base USDT address is intentionally NOT hardcoded. It stays
    // DISABLED until the address is confirmed and set in env (BASE_USDT_ADDRESS).
    usdtContract: '',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://basescan.org',
    envKeys: networkEnvKeys('base'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'optimism',
    name: 'Optimism',
    protocol: 'EVM',
    chainId: 10,
    nativeSymbol: 'ETH',
    usdtContract: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://optimistic.etherscan.io',
    envKeys: networkEnvKeys('optimism'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    protocol: 'EVM',
    chainId: 43114,
    nativeSymbol: 'AVAX',
    usdtContract: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    usdtDecimals: 6,
    requiredConfirmations: 12,
    explorer: 'https://snowtrace.io',
    envKeys: networkEnvKeys('avalanche'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'tron',
    name: 'TRON',
    protocol: 'TRON',
    // SLIP-44 coin type 195 is TRON's stable numeric network id (used as the
    // gateway's chain_id so the existing order/address/deposit plumbing works).
    chainId: TRON_CHAIN_ID,
    nativeSymbol: 'TRX',
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    usdtDecimals: 6,
    requiredConfirmations: 19,
    explorer: 'https://tronscan.org',
    envKeys: networkEnvKeys('tron'),
    depositEnabledDefault: false,
    watcherEnabledDefault: true,
    sweepEnabledDefault: true,
  },
  {
    id: 'solana',
    name: 'Solana',
    protocol: 'SOLANA',
    // SLIP-44 coin type 501 is Solana's stable numeric network id (used as the
    // gateway's chain_id so the existing order/address/deposit plumbing works).
    chainId: SOLANA_CHAIN_ID,
    nativeSymbol: 'SOL',
    // Official production Solana USDT (SPL) mint. Overridable via SOLANA_USDT_MINT.
    usdtContract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    usdtDecimals: 6,
    requiredConfirmations: 32,
    explorer: 'https://solscan.io',
    envKeys: {
      rpc: ['SOLANA_RPC_URL', 'SOLANA_RPC_URL_FALLBACK', 'SOLANA_RPC_URL_FALLBACK_2'],
      usdt: 'SOLANA_USDT_MINT',
      decimals: 'SOLANA_USDT_DECIMALS',
      confirmations: 'SOLANA_REQUIRED_CONFIRMATIONS',
      explorer: 'SOLANA_EXPLORER_URL',
      depositEnabled: 'SOLANA_DEPOSIT_ENABLED',
      watcherEnabled: 'SOLANA_WATCHER_ENABLED',
      sweepEnabled: 'SOLANA_SWEEP_ENABLED',
      treasury: 'SOLANA_TREASURY_ADDRESS',
    },
    depositEnabledDefault: false,
    watcherEnabledDefault: false,
    sweepEnabledDefault: false,
  },
];

// ============================================================
// CONFIG VALIDATION (fail fast on bad static configuration)
// ============================================================

export function validateNetworkDefinitions(
  definitions: NetworkDefinition[],
): void {
  const seenIds = new Set<string>();
  const seenChainIds = new Set<number>();

  for (const d of definitions) {
    if (seenIds.has(d.id)) {
      throw new Error(`Duplicate network id in config: ${d.id}`);
    }
    seenIds.add(d.id);

    if (!d.id || !d.name) {
      throw new Error('Network config requires non-empty id and name');
    }

    if (d.protocol === 'EVM') {
      if (!Number.isInteger(d.chainId) || (d.chainId as number) <= 0) {
        throw new Error(`Invalid chainId for EVM network ${d.id}: ${d.chainId}`);
      }
      if (seenChainIds.has(d.chainId as number)) {
        throw new Error(`Duplicate chainId ${d.chainId} in network config`);
      }
      seenChainIds.add(d.chainId as number);

      if (d.usdtContract && !ethers.isAddress(d.usdtContract)) {
        throw new Error(
          `Invalid USDT contract address for ${d.id}: ${d.usdtContract}`,
        );
      }
    } else if (d.chainId !== null) {
      // Non-EVM networks use their SLIP-44 coin type as a stable numeric id
      // (e.g. TRON = 195); null means "not implemented yet" (e.g. Solana).
      if (!Number.isInteger(d.chainId) || d.chainId <= 0) {
        throw new Error(`Invalid chainId for network ${d.id}: ${d.chainId}`);
      }
      if (seenChainIds.has(d.chainId)) {
        throw new Error(`Duplicate chainId ${d.chainId} in network config`);
      }
      seenChainIds.add(d.chainId);
    }
  }
}

// Validate the static definitions at import time so bad config fails fast.
validateNetworkDefinitions(NETWORK_DEFINITIONS);

