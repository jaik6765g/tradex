// ============================================================
// TRADEX BSC CONFIGURATION
// ============================================================

import { registerAs } from '@nestjs/config';

export default registerAs('bsc', () => ({
  // ==========================================================
  // RPC
  // ==========================================================

  rpcUrl: process.env.BSC_RPC_URL,

  rpcUrlFallback: process.env.BSC_RPC_URL_FALLBACK,

  // ==========================================================
  // CONTRACTS
  // ==========================================================

  usdtAddress: process.env.BSC_USDT_ADDRESS,

  vaultAddress: process.env.TRADEX_VAULT_ADDRESS,

  // ==========================================================
  // NETWORK
  // ==========================================================

  chainId: parseInt(process.env.BSC_CHAIN_ID || '56', 10),

  // ==========================================================
  // DEPOSIT CONFIRMATIONS
  // ==========================================================

  requiredConfirmations: parseInt(
    process.env.BSC_REQUIRED_CONFIRMATIONS || '15',
    10,
  ),

  // ==========================================================
  // SCAN INTERVAL
  // ==========================================================

  scanInterval: parseInt(process.env.BSC_SCAN_INTERVAL || '60000', 10),

  // ==========================================================
  // MAX BLOCKS PER eth_getLogs REQUEST
  // ==========================================================
  //
  // Keep this conservative for public RPC endpoints.
  //
  // 50 blocks is intentional.
  //
  // The watcher also applies its own hard safety cap.
  // ==========================================================

  maxBlocksPerScan: parseInt(process.env.BSC_MAX_BLOCKS_PER_SCAN || '50', 10),
}));
