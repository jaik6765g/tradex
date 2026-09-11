// ============================================================
// TRADEX BOT TYPES
// ============================================================

/**
 * Bot account status.
 */
export type BotAccountStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'closed';

/**
 * Bot wallet transfer direction.
 *
 * TRANSFER_IN:
 * Main Wallet -> Bot Wallet
 *
 * TRANSFER_OUT:
 * Bot Wallet -> Main Wallet
 */
export type BotWalletTransferDirection =
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

/**
 * Wallet identifiers used by the transfer UI.
 */
export type BotTransferWallet =
  | 'MAIN_WALLET'
  | 'BOT_WALLET';

/**
 * Bot wallet.
 */
export interface BotWallet {
  id: string;
  botAccountId: string;

  /**
   * Spendable Bot Wallet balance.
   */
  availableBalance: string;

  /**
   * Amount currently locked.
   */
  lockedBalance: string;

  /**
   * Total Bot Wallet balance.
   *
   * Usually:
   * availableBalance + lockedBalance
   */
  totalBalance: string;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * Bot Account.
 */
export interface BotAccount {
  id: string;

  /**
   * Permanent public Bot ID.
   *
   * Example:
   * TDX1000
   */
  botId: string;

  userId: string;

  status: BotAccountStatus;

  /**
   * Total principal activated into the Bot.
   */
  principal: string;

  activatedAt?: string | null;
  suspendedAt?: string | null;
  closedAt?: string | null;

  /**
   * Depending on backend response,
   * wallet may be attached directly to account.
   */
  wallet?: BotWallet | null;

  /**
   * Backend entity may return botWallet
   * instead of wallet.
   */
  botWallet?: BotWallet | null;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * Standard Bot Account API response.
 *
 * Supports the normalized frontend structure:
 *
 * {
 *   account: {...},
 *   wallet: {...}
 * }
 */
export interface BotAccountResponse {
  account: BotAccount;
  wallet?: BotWallet | null;
}

/**
 * Request for transferring funds between
 * Main Wallet and Bot Wallet.
 */
export interface TransferBotWalletRequest {
  amount: string;
  direction: BotWalletTransferDirection;
}

/**
 * Bot activation request.
 */
export interface ActivateBotRequest {
  amount: string;

  /**
   * Unique key used to prevent duplicate activation.
   */
  idempotencyKey: string;
}

/**
 * Bot activation status.
 */
export type BotActivationStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Bot activation record.
 */
export interface BotActivation {
  id: string;

  botAccountId: string;

  /**
   * Principal amount used for activation.
   */
  principal: string;

  /**
   * Amount allocated to liquidity.
   */
  liquidityAmount: string;

  /**
   * Amount reserved for first referral.
   */
  firstReferralReserve: string;

  status: BotActivationStatus;

  /**
   * True when this is the first qualifying activation.
   */
  isFirstQualifyingActivation: boolean;

  idempotencyKey: string;

  /**
   * Blockchain transaction hash.
   *
   * Currently may be null because activation
   * can be recorded before blockchain settlement.
   */
  blockchainTxHash?: string | null;

  activatedAt?: string | null;

  failureReason?: string | null;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * Bot activity filters.
 */
export type BotActivityFilter =
  | 'ALL'
  | 'WALLET'
  | 'STATUS'
  | 'TRADE';

/**
 * Bot activity category.
 */
export type BotActivityCategory =
  | 'TRADE'
  | 'WALLET'
  | 'STATUS';

/**
 * Bot activity direction.
 */
export type BotActivityDirection =
  | 'CREDIT'
  | 'DEBIT'
  | 'NEUTRAL';

/**
 * Bot wallet transaction types.
 */
export type BotWalletTransactionType =
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'BOT_ACTIVATION'
  | 'BOT_DEACTIVATION'
  | 'PROFIT_CREDIT'
  | 'LOSS_DEBIT'
  | 'SETTLEMENT';

/**
 * Bot wallet transaction status.
 */
export type BotWalletTransactionStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Individual Bot activity item.
 */
export interface BotActivityItem {
  id: string;

  type: BotWalletTransactionType;

  category: BotActivityCategory;

  title: string;

  description: string;

  /**
   * Unsigned amount.
   *
   * Example:
   * 1000.000000000000000000
   */
  amount: string;

  /**
   * Signed amount based on transaction direction.
   *
   * Example:
   * +1000.000000000000000000
   * -500.000000000000000000
   */
  signedAmount: string;

  direction: BotActivityDirection;

  status: BotWalletTransactionStatus;

  referenceType: string | null;

  referenceId: string | null;

  createdAt: string;
}

/**
 * Bot activity query.
 */
export interface BotActivityQuery {
  page?: number;
  limit?: number;
  filter?: BotActivityFilter;
}

/**
 * Bot activity API response.
 */
export interface BotActivityResponse {
  items: BotActivityItem[];

  total: number;

  page: number;

  limit: number;

  hasMore: boolean;
}

/**
 * Referral performance summary for Bot.
 *
 * Kept flexible because the backend referral-performance
 * response can contain additional fields.
 */
export interface BotReferralPerformance {
  [key: string]: unknown;
}