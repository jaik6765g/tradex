// frontend/src/admin/types/admin.types.ts

// ============================================================
// BASE TYPES
// ============================================================

export type AdminMetricValue = string | number | boolean | null;

export type AdminMetricApiSource =
  | 'users'
  | 'deposits'
  | 'withdrawals'
  | 'pulseLiquidity'
  | 'pulseTrades';

export type AdminUserMetricKey =
  | 'totalUsers'
  | 'activeUsers24h'
  | 'newUsersToday'
  | 'newUsers7d'
  | 'newUsers30d'
  | 'suspendedUsers'
  | 'inactiveUsers'
  | 'tradingUsers';

export interface AdminMetricAvailability {
  available: boolean;
  reason?: string;
}

// ============================================================
// DASHBOARD
// ============================================================

export interface AdminUserDashboardMetricsResponse {
  totalUsers: number | null;
  activeUsers24h: number | null;
  newUsersToday: number | null;
  newUsers7d: number | null;
  newUsers30d: number | null;
  suspendedUsers: number | null;
  inactiveUsers: number | null;
  tradingUsers: number | null;
  availability: Record<AdminUserMetricKey, AdminMetricAvailability>;
  generatedAt: string;
}

export interface AdminCountVolumeMetric {
  count: number;
  volume: string;
}

export interface AdminVaultMetric {
  balance: string | null;
  symbol: string;
  chainId: number | null;
  address: string | null;
  tokenAddress: string | null;
  fetchedAt: string;
  available: boolean;
  error?: string;
}

export interface AdminDashboardMetrics {
  users: {
    totalUsers: AdminMetricValue;
    activeUsers24h: AdminMetricValue;
    newUsersToday: AdminMetricValue;
    newUsers7d: AdminMetricValue;
    newUsers30d: AdminMetricValue;
    suspendedUsers: AdminMetricValue;
    inactiveUsers: AdminMetricValue;
    tradingUsers: AdminMetricValue;
    availability: Record<AdminUserMetricKey, AdminMetricAvailability>;
  };
  liquidity: {
    platformTdxBalance: AdminMetricValue;
    availableLiquidity: AdminMetricValue;
    reservedLiquidity: AdminMetricValue;
    openTradeExposure: AdminMetricValue;
  };
  trades: {
    todaysTradeVolume: AdminMetricValue;
    openTrades: AdminMetricValue;
    settledTrades: AdminMetricValue;
    settlementDelayed: AdminMetricValue;
    settlementFailed: AdminMetricValue;
    totalStake: AdminMetricValue;
    totalPayout: AdminMetricValue;
    totalProfit: AdminMetricValue;
  };
  withdrawals: {
    totalWithdrawals: AdminMetricValue;
    totalWithdrawalsVolume: AdminMetricValue;
    todaysWithdrawals: AdminMetricValue;
    todaysWithdrawalsVolume: AdminMetricValue;
    pendingWithdrawals: AdminMetricValue;
    processingWithdrawals: AdminMetricValue;
    completedWithdrawals: AdminMetricValue;
    failedWithdrawals: AdminMetricValue;
    rejectedWithdrawals: AdminMetricValue;
    cancelledWithdrawals: AdminMetricValue;
    withdrawalVaultFund: AdminMetricValue;
    withdrawalVaultMeta: AdminVaultMetric;
  };
  deposits: {
    totalDeposits: AdminMetricValue;
    totalDepositsVolume: AdminMetricValue;
    todaysDeposits: AdminMetricValue;
    todaysDepositsVolume: AdminMetricValue;
    pendingDeposits: AdminMetricValue;
    confirmingDeposits: AdminMetricValue;
    completedDeposits: AdminMetricValue;
    failedDeposits: AdminMetricValue;
    depositVaultFund: AdminMetricValue;
    depositVaultMeta: AdminVaultMetric;
  };
  source: 'existing-endpoints';
  fetchedAt: string;
  errors: Partial<Record<AdminMetricApiSource, string>>;
}

// ============================================================
// API ENVELOPE
// ============================================================

export interface AdminApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ============================================================
// DEPOSITS
// ============================================================

export type AdminDepositStatus =
  | 'PENDING'
  | 'CONFIRMING'
  | 'VERIFIED'
  | 'COMPLETED'
  | 'FAILED';

export type AdminDepositFilterStatus = AdminDepositStatus | 'ALL';

export interface AdminDeposit {
  id: string;
  userId: string;
  chainId: number;
  transactionHash: string;
  usdtAmount: number | string;
  tdxAmount: number | string;
  status: AdminDepositStatus;
  confirmations: number;
  requiredConfirmations: number;
  createdAt: string;
  confirmedAt?: string;
  creditedAt?: string;
}

export interface DepositStatisticsResponse {
  total: AdminCountVolumeMetric;
  today: AdminCountVolumeMetric;
  statuses: {
    pending: number;
    confirming: number;
    verified: number;
    completed: number;
    failed: number;
  };
  vault: AdminVaultMetric;
}

export type DepositStatisticsEnvelope = AdminApiEnvelope<DepositStatisticsResponse>;

// ============================================================
// WITHDRAWALS
// ============================================================

export type AdminWithdrawalStatus =
  | 'REQUESTED'
  | 'RISK_CHECKING'
  | 'LIQUIDITY_CHECK'
  | 'PENDING_ADMIN_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'HOLD';

export type AdminWithdrawalFilterStatus = AdminWithdrawalStatus | 'ALL';

export interface AdminWithdrawal {
  id: string;
  userId: string;
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  tdxAmount: string;
  usdtAmount: string;
  fee: string;
  status: AdminWithdrawalStatus;
  riskPassed: boolean;
  liquidityPassed: boolean;
  adminApproved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  payoutWalletAddress?: string;
  txHash?: string;
  metadata?: Record<string, unknown>;
  payoutAttempted: boolean;
  payoutIdempotencyKey?: string;
  payoutSubmittedAt?: string;
  payoutConfirmedAt?: string;
  rejectionReason?: string;
  riskReason?: string;
  verifiedAt?: string;
  processedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWithdrawalsResponse {
  data: AdminWithdrawal[];
  total: number;
}

export interface AdminWithdrawalsEnvelope extends AdminWithdrawalsResponse {
  success: boolean;
}

export interface AdminWithdrawalsQueryParams {
  limit?: number;
  offset?: number;
  status?: AdminWithdrawalFilterStatus;
  search?: string;
}

export interface WithdrawalStatisticsResponse {
  total: AdminCountVolumeMetric;
  today: AdminCountVolumeMetric;
  statuses: {
    requested: number;
    riskChecking: number;
    liquidityCheck: number;
    pendingAdminApproval: number;
    approved: number;
    queued: number;
    processing: number;
    sent: number;
    completed: number;
    failed: number;
    rejected: number;
    cancelled: number;
    hold: number;
  };
  vault: AdminVaultMetric;
}

export type WithdrawalsStatisticsEnvelope = AdminApiEnvelope<WithdrawalStatisticsResponse>;

// ============================================================
// USERS
// ============================================================

export type AdminUserStatus = 'active' | 'inactive' | 'blocked';
export type AdminUserFilterStatus = AdminUserStatus | 'ALL';

export interface AdminUserBalance {
  availableBalance: string;
  lockedBalance: string;
  totalBalance: string;
}

export interface AdminUser {
  id: string;
  walletAddress: string;
  status: AdminUserStatus;
  referralCode: string | null;
  referredBy: string | null;
  createdAt: string;
  updatedAt: string;
  balance: AdminUserBalance | null;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUsersQueryParams {
  limit?: number;
  offset?: number;
  status?: AdminUserFilterStatus;
  search?: string;
}

// ============================================================
// REFERRALS
// ============================================================

export interface AdminReferral {
  id: string;
  walletAddress: string;
  referralCode: string | null;
  referredBy: string | null;
  referrerWalletAddress: string | null;
  directReferralsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReferralsResponse {
  items: AdminReferral[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminReferralsQueryParams {
  limit?: number;
  offset?: number;
  search?: string;
}

// ============================================================
// LEDGER
// ============================================================

export type AdminLedgerType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'GAME_ENTRY'
  | 'GAME_WIN'
  | 'GAME_FEE'
  | 'TRADE_ENTRY'
  | 'TRADE_PROFIT'
  | 'TRADE_LOSS'
  | 'TRADE_DRAW'
  | 'TRADE_FEE'
  | 'WITHDRAWAL_LOCK'
  | 'WITHDRAWAL_RELEASE'
  | 'ADMIN_ADJUSTMENT';

export type AdminLedgerFilterType = AdminLedgerType | 'ALL';

export interface AdminLedgerEntry {
  id: string;
  userId: string;
  walletAddress: string | null;
  type: AdminLedgerType;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceId: string | null;
  referenceType: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminLedgerResponse {
  items: AdminLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminLedgerQueryParams {
  limit?: number;
  offset?: number;
  search?: string;
  type?: AdminLedgerFilterType;
}

// ============================================================
// AUDIT LOGS
// ============================================================

export type AdminAuditLogAction = string;

export interface AdminAuditLogEntry {
  id: string;
  adminId: string;
  action: AdminAuditLogAction;
  targetType: string;
  targetId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditLogsResponse {
  items: AdminAuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAuditLogsQueryParams {
  limit?: number;
  offset?: number;
  action?: string;
  adminId?: string;
  targetType?: string;
  from?: string;
  to?: string;
}

// ============================================================
// SETTINGS
// ============================================================

export type AdminSettingValueType = 'string' | 'number' | 'boolean' | 'json';

export interface AdminSettingItem {
  id: string;
  key: string;
  value: string;
  valueType: AdminSettingValueType;
  parsedValue: string | number | boolean | Record<string, unknown> | unknown[];
  description: string | null;
  editable: boolean;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AdminSettingsResponse {
  items: AdminSettingItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSettingsQueryParams {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface UpdateAdminSettingPayload {
  value: string;
  valueType?: AdminSettingValueType;
  description?: string;
  editable?: boolean;
}

// ============================================================
// PULSE TRADE
// ============================================================

export type AdminPulseTradeStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'ACCEPTED'
  | 'ENTRY_CLOSED'
  | 'EXPIRING'
  | 'SETTLING'
  | 'SETTLEMENT_DELAYED'
  | 'SETTLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SETTLEMENT_FAILED';

export type AdminPulseTradeResult = 'WIN' | 'LOSS' | 'DRAW' | null;
export type AdminPulseTradeDirection = 'LONG' | 'SHORT';

export type AdminPulseTradeFilterStatus = AdminPulseTradeStatus | 'ALL';
export type AdminPulseTradeFilterDirection = AdminPulseTradeDirection | 'ALL';
export type AdminPulseTradeFilterResult = Exclude<AdminPulseTradeResult, null> | 'ALL';
export type AdminPulseTradeFilterDuration = string | 'ALL';

export interface AdminPulseTrade {
  id: string;
  userId: string;
  walletAddress: string | null;
  symbol: string;
  direction: AdminPulseTradeDirection;
  duration: string;
  stake: string;
  fee: string;
  netStake: string;
  entryPrice: string;
  expiryPrice: string | null;
  entryAt: string;
  expiresAt: string;
  settledAt: string | null;
  status: AdminPulseTradeStatus | string;
  result: AdminPulseTradeResult;
  payout: string | null;
  pnl: string | null;
  remainingSeconds: number;
  settlementRetryCount: number;
  settlementFailureReason: string | null;
  lastSettlementAttemptAt: string | null;
  nextSettlementRetryAt: string | null;
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPulseTradesResponse {
  trades: AdminPulseTrade[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminPulseTradeQuery {
  limit?: number;
  offset?: number;
  search?: string;
  symbol?: string;
  status?: AdminPulseTradeStatus;
  direction?: AdminPulseTradeDirection;
  duration?: string;
  result?: Exclude<AdminPulseTradeResult, null>;
  from?: string;
  to?: string;
}

export interface AdminPulseTradeDetailResponse {
  trade: AdminPulseTrade;
}

export interface AdminPulseTradeMetrics {
  totalTrades: number;
  openTrades: number;
  settledTrades: number;
  todaysTradeVolume: string;
  settlementDelayed: number;
  settlementFailed: number;
  totalStake: string;
  totalPayout: string;
  totalProfit: string;
}

// ============================================================
// ENUM CONSTANTS (Optional - For Type Safety)
// ============================================================

export const ADMIN_DEPOSIT_STATUSES = {
  PENDING: 'PENDING',
  CONFIRMING: 'CONFIRMING',
  VERIFIED: 'VERIFIED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type AdminDepositStatusValues = typeof ADMIN_DEPOSIT_STATUSES[keyof typeof ADMIN_DEPOSIT_STATUSES];

export const ADMIN_WITHDRAWAL_STATUSES = {
  REQUESTED: 'REQUESTED',
  RISK_CHECKING: 'RISK_CHECKING',
  LIQUIDITY_CHECK: 'LIQUIDITY_CHECK',
  PENDING_ADMIN_APPROVAL: 'PENDING_ADMIN_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  HOLD: 'HOLD',
} as const;

export type AdminWithdrawalStatusValues = typeof ADMIN_WITHDRAWAL_STATUSES[keyof typeof ADMIN_WITHDRAWAL_STATUSES];

export const ADMIN_LEDGER_TYPES = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  GAME_ENTRY: 'GAME_ENTRY',
  GAME_WIN: 'GAME_WIN',
  GAME_FEE: 'GAME_FEE',
  TRADE_ENTRY: 'TRADE_ENTRY',
  TRADE_PROFIT: 'TRADE_PROFIT',
  TRADE_LOSS: 'TRADE_LOSS',
  TRADE_DRAW: 'TRADE_DRAW',
  TRADE_FEE: 'TRADE_FEE',
  WITHDRAWAL_LOCK: 'WITHDRAWAL_LOCK',
  WITHDRAWAL_RELEASE: 'WITHDRAWAL_RELEASE',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
} as const;

export type AdminLedgerTypeValues = typeof ADMIN_LEDGER_TYPES[keyof typeof ADMIN_LEDGER_TYPES];

export const ADMIN_PULSE_TRADE_STATUSES = {
  CREATED: 'CREATED',
  VALIDATING: 'VALIDATING',
  ACCEPTED: 'ACCEPTED',
  ENTRY_CLOSED: 'ENTRY_CLOSED',
  EXPIRING: 'EXPIRING',
  SETTLING: 'SETTLING',
  SETTLEMENT_DELAYED: 'SETTLEMENT_DELAYED',
  SETTLED: 'SETTLED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',
} as const;

export type AdminPulseTradeStatusValues = typeof ADMIN_PULSE_TRADE_STATUSES[keyof typeof ADMIN_PULSE_TRADE_STATUSES];

export const ADMIN_USER_STATUSES = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
} as const;

export type AdminUserStatusValues = typeof ADMIN_USER_STATUSES[keyof typeof ADMIN_USER_STATUSES];

export const ADMIN_SETTING_VALUE_TYPES = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json',
} as const;

export type AdminSettingValueTypeValues = typeof ADMIN_SETTING_VALUE_TYPES[keyof typeof ADMIN_SETTING_VALUE_TYPES];

// ============================================================
// ADMIN FINANCIAL OVERVIEW
// Source: GET /admin/financial-overview
// ============================================================

export type FinancialPoolStatus =
  | 'ACTIVE'
  | 'LOW'
  | 'WARNING'
  | 'EMPTY'
  | 'PAUSED'
  | 'ERROR';

export interface FinancialOverviewSection<T> {
  available: boolean;
  source: string;
  error?: string;
  data?: T;
}

export interface AdminFinancialOverviewResponse {
  fetchedAt: string;
  usersTdx: FinancialOverviewSection<{
    accountsCount: number;
    totalTdx: string;
    availableTdx: string;
    lockedTdx: string;
    withdrawalLockedTdx: string;
    gameLockedTdx: string;
    tradingLockedTdx: string;
  }>;
  userLedger: FinancialOverviewSection<{
    lifetimeDepositedTdx: string;
    lifetimeWithdrawnTdx: string;
    depositCount: number;
    withdrawalCount: number;
  }>;
  platformPool: FinancialOverviewSection<{
    currentTdx: string;
    reservedTdx: string;
    availableTdx: string;
    utilizationPercent: number;
    riskState: string;
    status: FinancialPoolStatus;
  }>;
  adminLiquidity: FinancialOverviewSection<{
    addedTdx: string;
    removedTdx: string;
    netAddedTdx: string;
    adjustmentsCount: number;
    lastAdjustmentAt: string | null;
    status: FinancialPoolStatus;
  }>;
  botLiquidity: FinancialOverviewSection<{
    walletsCount: number;
    totalTdx: string;
    availableTdx: string;
    lockedTdx: string;
    inflowTdx: string;
    deployedTdx: string;
    activeActivations: number;
    status: FinancialPoolStatus;
  }>;
  lottoFeePool: FinancialOverviewSection<{
    totalTdx: string;
    availableTdx: string;
    lockedTdx: string;
    collectedTdx: string;
    withdrawnTdx: string;
    status: FinancialPoolStatus;
  }>;
  totals: {
    allUsersTdx: string | null;
    platformLiquidityTdx: string | null;
    platformOwnedTdx: string | null;
    totalTrackedTdx: string | null;
    sources: string[];
  };
  recentLiquidityActivity: Array<{
    id: string;
    date: string;
    type: 'ADD' | 'REMOVE';
    amountTdx: string;
    source: string;
    status: 'SUCCESS' | 'FAILED';
    adminId: string;
    reason: string;
  }>;
}

export type AdminFinancialOverviewEnvelope = AdminApiEnvelope<AdminFinancialOverviewResponse>;

// ============================================================
// ADMIN BOT SETTINGS
// Source: GET/PUT /bot/settings
// ============================================================

export interface BotSettings {
  minimumActivation: string;
  maximumActivation: string;
  liquidityAllocationRate: string;
  firstReferralRate: string;
  firstReferralLevel1Rate: string;
  firstReferralLevel2Rate: string;
  firstReferralLevel3Rate: string;
  firstReferralLevel4Rate: string;
  firstReferralLevel5Rate: string;
  firstReferralLevel6Rate: string;
  firstReferralLevel1DirectRequired: number;
  firstReferralLevel2DirectRequired: number;
  firstReferralLevel3DirectRequired: number;
  firstReferralLevel4DirectRequired: number;
  firstReferralLevel5DirectRequired: number;
  firstReferralLevel6DirectRequired: number;
  updatedAt: string;
}

export interface UpdateBotSettingsPayload {
  minimumActivation?: string;
  maximumActivation?: string;
  liquidityAllocationRate?: string;
  firstReferralRate?: string;
  firstReferralLevel1Rate?: string;
  firstReferralLevel2Rate?: string;
  firstReferralLevel3Rate?: string;
  firstReferralLevel4Rate?: string;
  firstReferralLevel5Rate?: string;
  firstReferralLevel6Rate?: string;
  firstReferralLevel1DirectRequired?: number;
  firstReferralLevel2DirectRequired?: number;
  firstReferralLevel3DirectRequired?: number;
  firstReferralLevel4DirectRequired?: number;
  firstReferralLevel5DirectRequired?: number;
  firstReferralLevel6DirectRequired?: number;
}

// ============================================================
// ADMIN MANUAL BONUS DISTRIBUTION
// ============================================================

export interface DistributeBonusPayload {
  userId: string;
  amount: number;
  description: string;
  idempotencyKey?: string;
}

export interface AdminBonusDistributionResult {
  ledgerEntryId: string;
  userId: string;
  amount: string;
  description: string;
  availableBalanceBefore: string;
  availableBalanceAfter: string;
  totalBalanceBefore: string;
  totalBalanceAfter: string;
  adminId: string;
  idempotencyKey: string | null;
  replayed: boolean;
  distributedAt: string;
}

export interface AdminBonusDistributionEnvelope {
  success: boolean;
  data: AdminBonusDistributionResult;
  message: string;
}

export interface AdminBonusHistoryQueryParams {
  limit?: number;
  offset?: number;
  userId?: string;
}

export interface AdminBonusHistoryItem {
  id: string;
  userId: string;
  walletAddress: string | null;
  amount: string;
  description: string;
  adminId: string | null;
  adminEmail: string | null;
  createdAt: string;
}

export interface AdminBonusHistoryResponse {
  items: AdminBonusHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminBonusHistoryEnvelope {
  success: boolean;
  data: AdminBonusHistoryResponse;
  message: string;
}