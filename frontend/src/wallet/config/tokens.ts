import { CHAIN_IDS } from './networks';

// ============================================================
// TRADEX TOKEN CONFIG
// ============================================================
//
// Production network:
// BSC Mainnet only
//
// Chain ID: 56
// Token: USDT
// ============================================================

export type SupportedTokenChainId =
  typeof CHAIN_IDS.BSC_MAINNET;

export type ChainTokenConfig = {
  usdtAddress: string;
};

// ============================================================
// BSC MAINNET USDT
// ============================================================

const bscUsdtFromEnv =
  import.meta.env.VITE_BSC_USDT_CONTRACT;

if (!bscUsdtFromEnv) {
  throw new Error(
    'VITE_BSC_USDT_CONTRACT is missing from frontend .env',
  );
}

// ============================================================
// CHAIN TOKENS
// ============================================================

export const CHAIN_TOKENS: Record<
  SupportedTokenChainId,
  ChainTokenConfig
> = {
  [CHAIN_IDS.BSC_MAINNET]: {
    usdtAddress: bscUsdtFromEnv,
  },
};

// ============================================================
// GET USDT ADDRESS
// ============================================================

export function getUsdtAddressByChainId(
  chainId: SupportedTokenChainId,
): string {
  return CHAIN_TOKENS[chainId].usdtAddress;
}

// ============================================================
// MISSING CONFIG CHECK
// ============================================================

export function getMissingUsdtConfig(): Array<{
  chainId: SupportedTokenChainId;
  envVar: string;
}> {
  const missing: Array<{
    chainId: SupportedTokenChainId;
    envVar: string;
  }> = [];

  if (!CHAIN_TOKENS[CHAIN_IDS.BSC_MAINNET].usdtAddress) {
    missing.push({
      chainId: CHAIN_IDS.BSC_MAINNET,
      envVar: 'VITE_BSC_USDT_CONTRACT',
    });
  }

  return missing;
}