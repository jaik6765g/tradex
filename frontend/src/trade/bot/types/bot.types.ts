export type BotAccountStatus =
  | 'inactive'
  | 'active'
  | 'suspended'
  | 'closed';

export interface BotWallet {
  id: string;
  botAccountId: string;
  availableBalance: string;
  lockedBalance?: string;
  totalBalance: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BotAccount {
  id: string;
  userId: string;
  botId: string;
  status: BotAccountStatus;
  activatedAt: string | null;
  principal: string;
  suspendedAt: string | null;
  closedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  wallet?: BotWallet;
}

export interface BotAccountResponse {
  account: BotAccount;
  wallet?: BotWallet;
}

export type BotWalletTransferDirection =
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

export type BotTransferWallet =
  | 'MAIN_WALLET'
  | 'BOT_WALLET';

export interface TransferBotWalletRequest {
  amount: string;
  direction: BotWalletTransferDirection;
}

export interface ActivateBotRequest {
  amount: string;
  idempotencyKey: string;
}

export interface BotActivation {
  id: string;
  botAccountId: string;
  principal: string;
  liquidityAmount: string;
  firstReferralReserve: string;
  status: string;
  isFirstQualifyingActivation: boolean;
  idempotencyKey: string;
  blockchainTxHash: string | null;
  activatedAt: string | null;
  failureReason: string | null;
  createdAt?: string;
}

export type BotActivityFilter =
  | 'ALL'
  | 'TRADE'
  | 'WALLET'
  | 'STATUS';

export type BotActivityCategory =
  | 'TRADE'
  | 'WALLET'
  | 'STATUS';

export type BotActivityDirection =
  | 'CREDIT'
  | 'DEBIT'
  | 'NEUTRAL';

export type BotWalletTransactionType =
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'BOT_ACTIVATION'
  | 'BOT_DEACTIVATION'
  | 'PROFIT_CREDIT'
  | 'LOSS_DEBIT'
  | 'SETTLEMENT';

export type BotWalletTransactionStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface BotActivityItem {
  id: string;
  type: BotWalletTransactionType;
  category: BotActivityCategory;
  title: string;
  description: string;
  amount: string;
  signedAmount: string;
  direction: BotActivityDirection;
  status: BotWalletTransactionStatus;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface BotActivityResponse {
  items: BotActivityItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface BotActivityQuery {
  page?: number;
  limit?: number;
  filter?: BotActivityFilter;
}

export interface BotReferralPerformance {
  directActive: number;
  teamActive: number;
  monthlyEarnings: string;
  previousMonthEarnings: string;
}
