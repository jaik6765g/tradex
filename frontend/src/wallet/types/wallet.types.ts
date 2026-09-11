// ============================================================
// TRADEX WALLET TYPES
// ============================================================

// ============================================================
// BLOCKCHAIN WALLET BALANCE
// ============================================================

export interface BlockchainBalance {
  /**
   * Native blockchain balance.
   * Example: BNB on BSC.
   */
  native: string;

  /**
   * Native token symbol.
   * Example: BNB.
   */
  nativeSymbol: string;

  /**
   * USDT balance directly read from blockchain.
   */
  usdt: string;
}

// ============================================================
// TRADEX TDX BALANCE
// ============================================================

export interface TdxBalance {
  /**
   * TDX available for trading/withdrawal/etc.
   */
  available: string;

  /**
   * Total TDX currently locked.
   */
  locked: string;

  /**
   * Total TDX balance.
   */
  total: string;

  /**
   * TDX locked by gaming.
   */
  gameLocked: string;

  /**
   * TDX locked by trading.
   */
  tradingLocked: string;

  /**
   * TDX locked for withdrawal.
   */
  withdrawalLocked: string;
}

// ============================================================
// COMBINED WALLET BALANCE
// ============================================================

export interface WalletBalance {
  /**
   * Blockchain USDT balance.
   *
   * This comes from:
   * USDT.balanceOf(walletAddress)
   */
  usdt: string;

  /**
   * TradeX available TDX balance.
   *
   * This comes from:
   * GET /balances/me
   */
  tdx: string;

  /**
   * Native blockchain balance.
   *
   * Example:
   * BNB on BSC Testnet.
   */
  native: string;

  /**
   * Native blockchain symbol.
   */
  nativeSymbol: string;

  /**
   * TradeX TDX available balance.
   */
  tdxAvailable: string;

  /**
   * TradeX TDX locked balance.
   */
  tdxLocked: string;

  /**
   * TradeX total TDX balance.
   */
  tdxTotal: string;

  /**
   * TDX locked for games.
   */
  gameLocked: string;

  /**
   * TDX locked for trading.
   */
  tradingLocked: string;

  /**
   * TDX locked for withdrawal.
   */
  withdrawalLocked: string;
}

// ============================================================
// TRANSACTION
// ============================================================

export interface Transaction {
  id: string;

  type:
    | 'deposit'
    | 'withdraw'
    | 'trade'
    | 'game'
    | 'bonus'
    | 'other';

  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'rejected'
    | 'approved'
    | 'cancelled'
    | 'verifying'
    | 'confirmed';

  amount: string;

  currency: string;

  /**
   * TDX amount associated with transaction.
   */
  tdxAmount?: string;

  /**
   * Blockchain transaction hash.
   */
  txHash?: string;

  timestamp: string;

  description?: string;
}

// ============================================================
// WALLET STATE
// ============================================================

export interface WalletState {
  balance: WalletBalance;

  transactions: Transaction[];

  isLoading: boolean;

  isConnecting: boolean;

  error: string | null;

  isConnected: boolean;

  isWrongNetwork: boolean;

  requiredChainId: number;

  requiredNetworkName: string;

  address: string | null;

  chainId: number | null;
}

// ============================================================
// WALLET STATUS
// ============================================================

export type WalletStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error';

// ============================================================
// WALLET CONNECTION STATUS
// ============================================================

export type WalletConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'wrong-network';

// ============================================================
// DEPOSIT STATUS
// ============================================================

export type DepositStatus =
  | 'idle'
  | 'checking'
  | 'approving'
  | 'waiting-approval'
  | 'depositing'
  | 'waiting-deposit'
  | 'verifying'
  | 'completed'
  | 'failed';

// ============================================================
// WITHDRAWAL STATUS
// ============================================================

export type WithdrawalStatus =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';