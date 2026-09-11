// frontend/src/admin/services/admin.service.ts

import { AxiosError } from 'axios';
import { parseUnits } from 'viem';

import { apiClient } from '../../core/api/client';
import type {
  PulseLiquidityResponse,
  PulseRiskResponse,
} from '../../trade/pulse/types';
import type {
  AdminApiEnvelope,
  AdminAuditLogEntry,
  AdminAuditLogsQueryParams,
  AdminAuditLogsResponse,
  AdminBonusDistributionEnvelope,
  AdminBonusHistoryEnvelope,
  AdminBonusHistoryQueryParams,
  AdminBonusHistoryResponse,
  AdminDeposit,
  AdminDepositFilterStatus,
  AdminDepositStatus,
  AdminLedgerFilterType,
  AdminLedgerQueryParams,
  AdminLedgerResponse,
  AdminPulseTrade,
  AdminPulseTradeFilterDirection,
  AdminPulseTradeFilterResult,
  AdminPulseTradeFilterStatus,
  AdminPulseTradeDetailResponse,
  AdminPulseTradeMetrics,
  AdminPulseTradeQuery,
  AdminPulseTradesResponse,
  AdminReferralsQueryParams,
  AdminReferralsResponse,
  AdminSettingsQueryParams,
  AdminSettingsResponse,
  AdminSettingItem,
  UpdateAdminSettingPayload,
  AdminUserFilterStatus,
  AdminUsersQueryParams,
  AdminUsersResponse,
  AdminWithdrawal,
  AdminWithdrawalFilterStatus,
  AdminWithdrawalsEnvelope,
  AdminWithdrawalsQueryParams,
  AdminWithdrawalsResponse,
  AdminMetricApiSource,
  AdminDashboardMetrics,
  AdminUserDashboardMetricsResponse,
  AdminUserMetricKey,
  AdminMetricAvailability,
  DepositStatisticsEnvelope,
  DepositStatisticsResponse,
  WithdrawalStatisticsResponse,
  WithdrawalsStatisticsEnvelope,
  AdminFinancialOverviewResponse,
  AdminFinancialOverviewEnvelope,
  BotSettings,
  UpdateBotSettingsPayload,
  DistributeBonusPayload,
} from '../types/admin.types';
import {
  USDT_DECIMALS,
} from '../../wallet/config/wallet';

const NA = 'N/A';
const NO_AUTHORITATIVE_API = 'No existing authoritative API';

const DEFAULT_USER_METRIC_AVAILABILITY: Record<AdminUserMetricKey, AdminMetricAvailability> = {
  totalUsers: { available: false, reason: NO_AUTHORITATIVE_API },
  activeUsers24h: { available: false, reason: NO_AUTHORITATIVE_API },
  newUsersToday: { available: false, reason: NO_AUTHORITATIVE_API },
  newUsers7d: { available: false, reason: NO_AUTHORITATIVE_API },
  newUsers30d: { available: false, reason: NO_AUTHORITATIVE_API },
  suspendedUsers: { available: false, reason: NO_AUTHORITATIVE_API },
  inactiveUsers: { available: false, reason: NO_AUTHORITATIVE_API },
  tradingUsers: { available: false, reason: NO_AUTHORITATIVE_API },
};

type ApiFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface AdminPayoutPreparation {
  withdrawalId: string;
  recipient: `0x${string}`;
  amountWei: bigint;
  amountDisplay: string;
}

export class AdminService {
  private static readonly DEPOSIT_STATUS_FILTERS: ReadonlySet<AdminDepositFilterStatus> =
    new Set([
      'ALL',
      'PENDING',
      'CONFIRMING',
      'VERIFIED',
      'COMPLETED',
      'FAILED',
    ]);

  private static readonly LEDGER_TYPE_FILTERS: ReadonlySet<AdminLedgerFilterType> =
    new Set([
      'ALL',
      'DEPOSIT',
      'WITHDRAWAL',
      'GAME_ENTRY',
      'GAME_WIN',
      'GAME_FEE',
      'TRADE_ENTRY',
      'TRADE_PROFIT',
      'TRADE_LOSS',
      'TRADE_DRAW',
      'TRADE_FEE',
      'WITHDRAWAL_LOCK',
      'WITHDRAWAL_RELEASE',
      'ADMIN_ADJUSTMENT',
    ]);

  private static readonly USER_STATUS_FILTERS: ReadonlySet<AdminUserFilterStatus> =
    new Set([
      'ALL',
      'active',
      'inactive',
      'blocked',
    ]);

  private static readonly WITHDRAWAL_STATUS_FILTERS: ReadonlySet<AdminWithdrawalFilterStatus> =
    new Set([
      'ALL',
      'REQUESTED',
      'RISK_CHECKING',
      'LIQUIDITY_CHECK',
      'PENDING_ADMIN_APPROVAL',
      'APPROVED',
      'REJECTED',
      'QUEUED',
      'PROCESSING',
      'SENT',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'HOLD',
    ]);

  private static readonly PULSE_TRADE_STATUS_FILTERS: ReadonlySet<AdminPulseTradeFilterStatus> =
    new Set([
      'ALL',
      'CREATED',
      'VALIDATING',
      'ACCEPTED',
      'ENTRY_CLOSED',
      'EXPIRING',
      'SETTLING',
      'SETTLEMENT_DELAYED',
      'SETTLED',
      'REJECTED',
      'CANCELLED',
      'SETTLEMENT_FAILED',
    ]);

  private static readonly PULSE_TRADE_DIRECTION_FILTERS: ReadonlySet<AdminPulseTradeFilterDirection> =
    new Set(['LONG', 'SHORT', 'ALL']);

  private static readonly PULSE_TRADE_RESULT_FILTERS: ReadonlySet<AdminPulseTradeFilterResult> =
    new Set(['WIN', 'LOSS', 'DRAW', 'ALL']);

  static async getDashboardMetrics(): Promise<AdminDashboardMetrics> {
    const [
      usersResult,
      depositResult,
      withdrawalResult,
      liquidityResult,
      pulseTradeResult,
    ] = await Promise.all([
      this.safeFetch('users', () => this.getAdminUserDashboardMetrics()),
      this.safeFetch('deposits', () => this.getDepositStatistics()),
      this.safeFetch('withdrawals', () => this.getWithdrawalStatistics()),
      this.safeFetch('pulseLiquidity', () => this.getAdminLiquidity()),
      this.safeFetch('pulseTrades', () => this.getAdminPulseTradeMetrics()),
    ]);

    const errors: Partial<Record<AdminMetricApiSource, string>> = {};

    if (!usersResult.ok) errors.users = usersResult.error;
    if (!depositResult.ok) errors.deposits = depositResult.error;
    if (!withdrawalResult.ok) errors.withdrawals = withdrawalResult.error;
    if (!liquidityResult.ok) errors.pulseLiquidity = liquidityResult.error;
    if (!pulseTradeResult.ok) errors.pulseTrades = pulseTradeResult.error;

    const pendingWithdrawals = withdrawalResult.ok
      ? this.sumStatuses(withdrawalResult.data.statuses, [
          'requested',
          'riskChecking',
          'liquidityCheck',
          'pendingAdminApproval',
          'hold',
        ])
      : NA;

    const processingWithdrawals = withdrawalResult.ok
      ? this.sumStatuses(withdrawalResult.data.statuses, ['queued', 'processing', 'sent'])
      : NA;

    const userMetricAvailability = this.resolveUserMetricAvailability(usersResult, errors.users);

    return {
      users: {
        totalUsers: usersResult.ok ? this.toMetricValue(usersResult.data.totalUsers) : NA,
        activeUsers24h: usersResult.ok ? this.toMetricValue(usersResult.data.activeUsers24h) : NA,
        newUsersToday: usersResult.ok ? this.toMetricValue(usersResult.data.newUsersToday) : NA,
        newUsers7d: usersResult.ok ? this.toMetricValue(usersResult.data.newUsers7d) : NA,
        newUsers30d: usersResult.ok ? this.toMetricValue(usersResult.data.newUsers30d) : NA,
        suspendedUsers: usersResult.ok ? this.toMetricValue(usersResult.data.suspendedUsers) : NA,
        inactiveUsers: usersResult.ok ? this.toMetricValue(usersResult.data.inactiveUsers) : NA,
        tradingUsers: usersResult.ok ? this.toMetricValue(usersResult.data.tradingUsers) : NA,
        availability: userMetricAvailability,
      },
      liquidity: {
        platformTdxBalance: liquidityResult.ok
          ? this.formatTokenAmount(liquidityResult.data.poolBalance, 'TDX')
          : NA,
        availableLiquidity: liquidityResult.ok
          ? this.formatTokenAmount(liquidityResult.data.availableLiquidity, 'TDX')
          : NA,
        reservedLiquidity: liquidityResult.ok
          ? this.formatTokenAmount(liquidityResult.data.reservedAmount, 'TDX')
          : NA,
        openTradeExposure: liquidityResult.ok
          ? this.formatTokenAmount(liquidityResult.data.openExposure, 'TDX')
          : NA,
      },
      trades: {
        todaysTradeVolume: pulseTradeResult.ok
          ? this.formatTokenAmount(pulseTradeResult.data.todaysTradeVolume, 'TDX')
          : NA,
        openTrades: pulseTradeResult.ok ? this.toMetricValue(pulseTradeResult.data.openTrades) : NA,
        settledTrades: pulseTradeResult.ok
          ? this.toMetricValue(pulseTradeResult.data.settledTrades)
          : NA,
        settlementDelayed: pulseTradeResult.ok
          ? this.toMetricValue(pulseTradeResult.data.settlementDelayed)
          : NA,
        settlementFailed: pulseTradeResult.ok
          ? this.toMetricValue(pulseTradeResult.data.settlementFailed)
          : NA,
        totalStake: pulseTradeResult.ok
          ? this.formatTokenAmount(pulseTradeResult.data.totalStake, 'TDX')
          : NA,
        totalPayout: pulseTradeResult.ok
          ? this.formatTokenAmount(pulseTradeResult.data.totalPayout, 'TDX')
          : NA,
        totalProfit: pulseTradeResult.ok
          ? this.formatTokenAmount(pulseTradeResult.data.totalProfit, 'TDX')
          : NA,
      },
      withdrawals: {
        totalWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.total.count)
          : NA,
        totalWithdrawalsVolume: withdrawalResult.ok
          ? this.formatTokenAmount(withdrawalResult.data.total.volume, 'USDT')
          : NA,
        todaysWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.today.count)
          : NA,
        todaysWithdrawalsVolume: withdrawalResult.ok
          ? this.formatTokenAmount(withdrawalResult.data.today.volume, 'USDT')
          : NA,
        pendingWithdrawals,
        processingWithdrawals,
        completedWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.statuses.completed)
          : NA,
        failedWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.statuses.failed)
          : NA,
        rejectedWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.statuses.rejected)
          : NA,
        cancelledWithdrawals: withdrawalResult.ok
          ? this.toMetricValue(withdrawalResult.data.statuses.cancelled)
          : NA,
        withdrawalVaultFund: withdrawalResult.ok
          ? this.formatVaultBalance(withdrawalResult.data.vault)
          : NA,
        withdrawalVaultMeta: withdrawalResult.ok
          ? withdrawalResult.data.vault
          : this.getUnavailableVaultMetric(),
      },
      deposits: {
        totalDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.total.count)
          : NA,
        totalDepositsVolume: depositResult.ok
          ? this.formatTokenAmount(depositResult.data.total.volume, 'USDT')
          : NA,
        todaysDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.today.count)
          : NA,
        todaysDepositsVolume: depositResult.ok
          ? this.formatTokenAmount(depositResult.data.today.volume, 'USDT')
          : NA,
        pendingDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.statuses.pending)
          : NA,
        confirmingDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.statuses.confirming)
          : NA,
        completedDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.statuses.completed)
          : NA,
        failedDeposits: depositResult.ok
          ? this.toMetricValue(depositResult.data.statuses.failed)
          : NA,
        depositVaultFund: depositResult.ok
          ? this.formatVaultBalance(depositResult.data.vault)
          : NA,
        depositVaultMeta: depositResult.ok
          ? depositResult.data.vault
          : this.getUnavailableVaultMetric(),
      },
      source: 'existing-endpoints',
      fetchedAt: new Date().toISOString(),
      errors,
    };
  }

  private static async getAdminUserDashboardMetrics(): Promise<AdminUserDashboardMetricsResponse> {
    const response = await apiClient.get<AdminUserDashboardMetricsResponse>(
      '/users/admin/metrics',
    );

    return response.data;
  }

  private static async getDepositStatistics(): Promise<DepositStatisticsResponse> {
    const response = await apiClient.get<DepositStatisticsEnvelope | DepositStatisticsResponse>(
      '/deposits/admin/statistics',
    );

    return this.normalizeStatisticsPayload(response.data, '/deposits/admin/statistics');
  }

  private static async getWithdrawalStatistics(): Promise<WithdrawalStatisticsResponse> {
    const response = await apiClient.get<WithdrawalsStatisticsEnvelope | WithdrawalStatisticsResponse>(
      '/withdrawals/admin/statistics',
    );

    return this.normalizeStatisticsPayload(response.data, '/withdrawals/admin/statistics');
  }

  /**
   * Complete TDX financial overview aggregated from the database by the
   * backend AdminFinancialOverviewService.
   *
   * Source: GET /admin/financial-overview
   *
   * Every section carries its DB source and an availability flag so the
   * frontend can show N/A for a failed source without blanking the rest
   * of the dashboard.
   */
  static async getFinancialOverview(): Promise<AdminFinancialOverviewResponse> {
    const response = await apiClient.get<AdminFinancialOverviewEnvelope>(
      '/admin/financial-overview',
    );

    return response.data.data;
  }

  static async getAdminLiquidity(): Promise<PulseLiquidityResponse> {
    const response = await apiClient.get<PulseLiquidityResponse>(
      '/pulse-trade/admin/liquidity',
    );

    return response.data;
  }

  static async getAdminRisk(): Promise<PulseRiskResponse> {
    const response = await apiClient.get<PulseRiskResponse>(
      '/pulse-trade/admin/risk',
    );

    return response.data;
  }

  static async adjustPulseAdminLiquidity(payload: {
    action: 'ADD' | 'REMOVE';
    amount: string;
    reason: string;
    reference?: string;
    note?: string;
  }): Promise<void> {
    const amount = String(payload.amount ?? '').trim();
    const reason = String(payload.reason ?? '').trim();

    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      throw new Error('Amount must be greater than 0.');
    }

    if (!reason) {
      throw new Error('Reason is required.');
    }

    await apiClient.post('/pulse-trade/admin/liquidity/adjust', {
      action: payload.action,
      amount,
      reason,
      ...(payload.reference?.trim() ? { reference: payload.reference.trim() } : {}),
      ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
    });
  }

  static async getPulseAdminLiquidityActivity(params: {
    limit?: number;
    offset?: number;
    action?: 'ALL' | 'ADD' | 'REMOVE';
    result?: 'ALL' | 'SUCCESS' | 'FAILED';
    adminId?: string;
    from?: string;
    to?: string;
  } = {}): Promise<{
    items: Array<{
      id: string;
      adminId: string;
      action: 'ADD' | 'REMOVE';
      amount: string;
      result: 'SUCCESS' | 'FAILED';
      reason: string;
      reference?: string | null;
      note?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      createdAt: string;
      [key: string]: unknown;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    if (params.action && params.action !== 'ALL') queryParams.action = params.action;
    if (params.result && params.result !== 'ALL') queryParams.result = params.result;

    const adminId = this.normalizeSearch(params.adminId);
    if (adminId) queryParams.adminId = adminId;

    const from = this.normalizeDateString(params.from);
    if (from) queryParams.from = from;

    const to = this.normalizeDateString(params.to);
    if (to) queryParams.to = to;

    const response = await apiClient.get(
      '/pulse-trade/admin/liquidity/activity',
      { params: queryParams },
    );

    const payload = response.data ?? {};
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.activities)
        ? payload.activities
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    return {
      items: items as Array<{
        id: string;
        adminId: string;
        action: 'ADD' | 'REMOVE';
        amount: string;
        result: 'SUCCESS' | 'FAILED';
        reason: string;
        reference?: string | null;
        note?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        createdAt: string;
        [key: string]: unknown;
      }>,
      total: this.toFiniteNumber(payload?.total, items.length),
      limit: this.normalizeLimit(payload?.limit ?? params.limit),
      offset: this.normalizeOffset(payload?.offset ?? params.offset),
    };
  }

  static async getPulseAdminLiquidity(): Promise<PulseLiquidityResponse> {
    return this.getAdminLiquidity();
  }

  static async getPulseAdminRisk(): Promise<PulseRiskResponse> {
    return this.getAdminRisk();
  }

  // ============================================================
  // DEPOSITS
  // ============================================================

  static async getAdminPendingDeposits(): Promise<AdminDeposit[]> {
    const response = await apiClient.get<AdminDeposit[]>('/deposits/admin/pending');
    const payload = response.data;

    return Array.isArray(payload) ? payload : [];
  }

  /**
   * Get all deposits with pagination, status filter, and search
   */
  static async getAdminDeposits(
    params: {
      limit?: number;
      offset?: number;
      status?: AdminDepositStatus;
      search?: string;
    } = {}
  ): Promise<{ data: AdminDeposit[]; total: number }> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    if (params.status) {
      queryParams.status = params.status;
    }

    const search = this.normalizeSearch(params.search);
    if (search) {
      queryParams.search = search;
    }

    const response = await apiClient.get<{ data: AdminDeposit[]; total: number }>(
      '/deposits/admin/all',
      { params: queryParams }
    );

    return response.data;
  }

  static filterDeposits(
    deposits: AdminDeposit[],
    filters: {
      status?: AdminDepositFilterStatus;
      search?: string;
    } = {},
  ): AdminDeposit[] {
    const normalizedStatus = this.normalizeDepositFilterStatus(filters.status);
    const normalizedSearch = this.normalizeSearch(filters.search)?.toLowerCase();

    return deposits.filter((deposit) => {
      if (normalizedStatus && normalizedStatus !== 'ALL' && deposit.status !== normalizedStatus) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchTarget = [
        deposit.id,
        deposit.userId,
        deposit.transactionHash,
        String(deposit.chainId),
      ]
        .join(' ')
        .toLowerCase();

      return searchTarget.includes(normalizedSearch);
    });
  }

  static async updateDepositStatus(
    depositId: string,
    status: AdminDepositStatus,
    reason?: string,
  ): Promise<void> {
    const payload: {
      status: AdminDepositStatus;
      reason?: string;
    } = {
      status,
    };

    const normalizedReason = this.normalizeSearch(reason);
    if (normalizedReason) {
      payload.reason = normalizedReason;
    }

    await apiClient.put(
      `/deposits/admin/${encodeURIComponent(depositId)}/status`,
      payload,
    );
  }

  static async creditDeposit(depositId: string): Promise<void> {
    await apiClient.post(`/deposits/admin/${encodeURIComponent(depositId)}/credit`);
  }

  // ============================================================
  // PULSE TRADE
  // ============================================================

  static async getAdminPulseTrades(
    params: AdminPulseTradeQuery = {},
  ): Promise<AdminPulseTradesResponse> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    const normalizedSearch = this.normalizeSearch(params.search);
    if (normalizedSearch) {
      queryParams.search = normalizedSearch;
    }

    const normalizedSymbol = this.normalizePulseTradeSymbol(params.symbol);
    if (normalizedSymbol) {
      queryParams.symbol = normalizedSymbol;
    }

    const normalizedStatus = this.normalizePulseTradeStatus(params.status);
    if (normalizedStatus && normalizedStatus !== 'ALL') {
      queryParams.status = normalizedStatus;
    }

    const normalizedDirection = this.normalizePulseTradeDirection(params.direction);
    if (normalizedDirection && normalizedDirection !== 'ALL') {
      queryParams.direction = normalizedDirection;
    }

    const normalizedDuration = this.normalizePulseTradeDuration(params.duration);
    if (normalizedDuration && normalizedDuration !== 'ALL') {
      queryParams.duration = normalizedDuration;
    }

    const normalizedResult = this.normalizePulseTradeResult(params.result);
    if (normalizedResult && normalizedResult !== 'ALL') {
      queryParams.result = normalizedResult;
    }

    const normalizedFrom = this.normalizeDateString(params.from);
    if (normalizedFrom) {
      queryParams.from = normalizedFrom;
    }

    const normalizedTo = this.normalizeDateString(params.to);
    if (normalizedTo) {
      queryParams.to = normalizedTo;
    }

    const response = await apiClient.get<AdminPulseTradesResponse>(
      '/pulse-trade/admin/trades',
      {
        params: queryParams,
      },
    );

    const payload = response.data;

    return {
      trades: Array.isArray(payload?.trades) ? payload.trades : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  static async getAdminPulseTradeById(tradeId: string): Promise<AdminPulseTrade> {
    const response = await apiClient.get<AdminPulseTradeDetailResponse>(
      `/pulse-trade/admin/trades/${encodeURIComponent(tradeId)}`,
    );

    const trade = response.data?.trade;

    if (!trade) {
      throw new Error('Failed to load pulse trade detail.');
    }

    return trade;
  }

  static async getAdminPulseTradeMetrics(): Promise<AdminPulseTradeMetrics> {
    const response = await apiClient.get<AdminPulseTradeMetrics>(
      '/pulse-trade/admin/metrics',
    );

    return response.data;
  }

  // ============================================================
  // WITHDRAWALS
  // ============================================================

  static async getAdminWithdrawals(
    params: AdminWithdrawalsQueryParams = {},
  ): Promise<AdminWithdrawalsResponse> {
    const normalizedStatus = this.normalizeWithdrawalFilterStatus(params.status);
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    if (normalizedStatus && normalizedStatus !== 'ALL') {
      queryParams.status = normalizedStatus;
    }

    const normalizedSearch = this.normalizeSearch(params.search);
    if (normalizedSearch) {
      queryParams.search = normalizedSearch;
    }

    const response = await apiClient.get<AdminWithdrawalsEnvelope>('/withdrawals/admin/all', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      data: Array.isArray(payload?.data) ? payload.data : [],
      total: this.toFiniteNumber(payload?.total, 0),
    };
  }

  // ============================================================
  // USERS
  // ============================================================

  static async getAdminUsers(
    params: AdminUsersQueryParams = {},
  ): Promise<AdminUsersResponse> {
    const normalizedStatus = this.normalizeUserFilterStatus(params.status);
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    if (normalizedStatus && normalizedStatus !== 'ALL') {
      queryParams.status = normalizedStatus;
    }

    const normalizedSearch = this.normalizeSearch(params.search);
    if (normalizedSearch) {
      queryParams.search = normalizedSearch;
    }

    const response = await apiClient.get<AdminUsersResponse>('/users/admin/all', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  // ============================================================
  // REFERRALS
  // ============================================================

  static async getAdminReferrals(
    params: AdminReferralsQueryParams = {},
  ): Promise<AdminReferralsResponse> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    const normalizedSearch = this.normalizeSearch(params.search);
    if (normalizedSearch) {
      queryParams.search = normalizedSearch;
    }

    const response = await apiClient.get<AdminReferralsResponse>('/users/admin/referrals', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  // ============================================================
  // ADMIN USER DETAILS
  // ============================================================

  static async getAdminUserDetails(userId: string) {
    const response = await apiClient.get(`/users/admin/users/${encodeURIComponent(userId)}/details`);
    return response.data;
  }

  // ============================================================
  // ADMIN REFERRAL DETAILS
  // ============================================================

  static async getAdminReferralDetails(userId: string) {
    const response = await apiClient.get(`/users/admin/referrals/${encodeURIComponent(userId)}/details`);
    return response.data;
  }

  // ============================================================
  // ADMIN MANUAL BONUS DISTRIBUTION
  // ============================================================

  /**
   * Distribute a manual bonus to a user (by UUID) with a mandatory
   * reason. Backend credits balance + ledger + audit log atomically.
   */
  static async distributeBonus(
    payload: DistributeBonusPayload,
  ): Promise<AdminBonusDistributionEnvelope> {
    const body: Record<string, string | number> = {
      userId: payload.userId,
      amount: payload.amount,
      description: payload.description,
    };

    const idempotencyKey = payload.idempotencyKey?.trim();
    if (idempotencyKey) {
      body.idempotencyKey = idempotencyKey;
    }

    const response = await apiClient.post<AdminBonusDistributionEnvelope>(
      '/admin/bonus/distribute',
      body,
    );

    return response.data;
  }

  /**
   * Manual bonus distribution history. Pass userId to scope the
   * history to a single user (used in the user detail modal).
   */
  static async getBonusHistory(
    params: AdminBonusHistoryQueryParams = {},
  ): Promise<AdminBonusHistoryResponse> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    const userId = params.userId?.trim();
    if (userId) {
      queryParams.userId = userId;
    }

    const response = await apiClient.get<AdminBonusHistoryEnvelope>(
      '/admin/bonus/history',
      { params: queryParams },
    );

    const payload = response.data?.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  // ============================================================
  // LEDGER
  // ============================================================

  static async getAdminLedger(
    params: AdminLedgerQueryParams = {},
  ): Promise<AdminLedgerResponse> {
    const normalizedType = this.normalizeLedgerFilterType(params.type);
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    if (normalizedType && normalizedType !== 'ALL') {
      queryParams.type = normalizedType;
    }

    const normalizedSearch = this.normalizeSearch(params.search);
    if (normalizedSearch) {
      queryParams.search = normalizedSearch;
    }

    const response = await apiClient.get<AdminLedgerResponse>('/ledger/admin/all', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  // ============================================================
  // AUDIT LOGS
  // ============================================================

  static async getAdminAuditLogs(
    params: AdminAuditLogsQueryParams = {},
  ): Promise<AdminAuditLogsResponse> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    const action = this.normalizeSearch(params.action);
    if (action) {
      queryParams.action = action;
    }

    const adminId = this.normalizeSearch(params.adminId);
    if (adminId) {
      queryParams.adminId = adminId;
    }

    const targetType = this.normalizeSearch(params.targetType);
    if (targetType) {
      queryParams.targetType = targetType;
    }

    const from = this.normalizeDateString(params.from);
    if (from) {
      queryParams.from = from;
    }

    const to = this.normalizeDateString(params.to);
    if (to) {
      queryParams.to = to;
    }

    const response = await apiClient.get<AdminAuditLogsResponse>('/admin/audit-logs', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  static async getAdminSettings(
    params: AdminSettingsQueryParams = {},
  ): Promise<AdminSettingsResponse> {
    const queryParams: Record<string, string | number> = {
      limit: this.normalizeLimit(params.limit),
      offset: this.normalizeOffset(params.offset),
    };

    const search = this.normalizeSearch(params.search);
    if (search) {
      queryParams.search = search;
    }

    const response = await apiClient.get<AdminSettingsResponse>('/admin/settings', {
      params: queryParams,
    });

    const payload = response.data;

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      total: this.toFiniteNumber(payload?.total, 0),
      limit: this.normalizeLimit(payload?.limit),
      offset: this.normalizeOffset(payload?.offset),
    };
  }

  static async getAdminRiskSecurity(): Promise<{
    liquidity: PulseLiquidityResponse;
    risk: PulseRiskResponse;
    alerts: AdminAuditLogEntry[];
    fetchedAt: string;
  }> {
    const [liquidity, risk, logs] = await Promise.all([
      this.getPulseAdminLiquidity(),
      this.getPulseAdminRisk(),
      this.getAdminAuditLogs({
        limit: 100,
        offset: 0,
      }),
    ]);

    const alerts = logs.items.filter((log) => this.isRiskSecurityAuditLog(log));

    return {
      liquidity,
      risk,
      alerts,
      fetchedAt: new Date().toISOString(),
    };
  }

  static async updateAdminSetting(
    key: string,
    payload: UpdateAdminSettingPayload,
  ): Promise<AdminSettingItem> {
    const normalizedKey = this.normalizeSearch(key);

    if (!normalizedKey) {
      throw new Error('Setting key is required');
    }

    const response = await apiClient.put(
      `/admin/settings/${encodeURIComponent(normalizedKey)}`,
      payload,
    );

    return response.data as AdminSettingItem;
  }

  // ============================================================
  // ADMIN BOT SETTINGS
  // ============================================================

  static async getBotSettings(): Promise<BotSettings> {
    const response = await apiClient.get<BotSettings>('/bot/settings');
    return response.data;
  }

  static async updateBotSettings(
    payload: UpdateBotSettingsPayload,
  ): Promise<BotSettings> {
    const response = await apiClient.put<BotSettings>(
      '/bot/settings',
      payload,
    );
    return response.data;
  }

  // ============================================================
  // ADMIN WITHDRAWAL ACTIONS
  // ============================================================

  static async approveWithdrawal(
    withdrawalId: string,
    payoutWalletAddress?: string,
    note?: string,
  ): Promise<void> {
    const normalizedWithdrawalId = String(withdrawalId ?? '').trim();
    const normalizedPayoutWalletAddress = String(payoutWalletAddress ?? '').trim();

    if (!normalizedWithdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    if (!this.isValidEvmWalletAddress(normalizedPayoutWalletAddress)) {
      throw new Error('A valid admin payout wallet address is required.');
    }

    await apiClient.patch(
      `/withdrawals/${encodeURIComponent(normalizedWithdrawalId)}/approve`,
      {
        payoutWalletAddress: normalizedPayoutWalletAddress,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    );
  }

  /**
   * Complete withdrawal after on-chain USDT transfer
   * 
   * IMPORTANT: This sends txHash in the request body
   */
  static async completeWithdrawal(
    withdrawalId: string,
    txHash: string,
  ): Promise<void> {
    console.log('🔍 [SERVICE] completeWithdrawal called:', { withdrawalId, txHash });

    const normalizedWithdrawalId = String(withdrawalId ?? '').trim();
    const normalizedTxHash = String(txHash ?? '').trim();

    if (!normalizedWithdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new Error('A valid transaction hash is required.');
    }

    const url = `/withdrawals/${encodeURIComponent(normalizedWithdrawalId)}/complete`;
    const payload = { txHash: normalizedTxHash };

    console.log('📡 [SERVICE] PATCH URL:', url);
    console.log('📡 [SERVICE] Payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await apiClient.patch(url, payload);
      console.log('✅ [SERVICE] completeWithdrawal response:', response.status);
      return response.data;
    } catch (error) {
      console.error('❌ [SERVICE] completeWithdrawal error:', error);
      if (error instanceof AxiosError) {
        console.error('❌ [SERVICE] Response data:', error.response?.data);
        console.error('❌ [SERVICE] Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Complete MULTIPLE withdrawals paid out by ONE single
   * WithdrawalVault.withdraw(recipients[], amounts[]) batch transaction.
   *
   * ONE txHash + MULTIPLE withdrawal IDs.
   *
   * IMPORTANT: The backend independently verifies the single
   * transaction and matches EVERY withdrawal to a unique USDT
   * Transfer event (Transfer.from === WithdrawalVault) before
   * atomically completing all of them.
   */
  static async completeBatchWithdrawals(
    withdrawalIds: string[],
    txHash: string,
  ): Promise<{
    txHash: string;
    withdrawals: AdminWithdrawal[];
    completedCount: number;
    alreadyCompletedCount: number;
    idempotent: boolean;
  }> {
    const normalizedIds = Array.from(
      new Set(
        (withdrawalIds ?? [])
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    );
    const normalizedTxHash = String(txHash ?? '').trim();

    if (normalizedIds.length === 0) {
      throw new Error('At least one withdrawal ID is required.');
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new Error('A valid transaction hash is required.');
    }

    const payload = {
      txHash: normalizedTxHash,
      withdrawalIds: normalizedIds,
    };

    const response = await apiClient.post('/withdrawals/batch/complete', payload);

    return response.data as {
      txHash: string;
      withdrawals: AdminWithdrawal[];
      completedCount: number;
      alreadyCompletedCount: number;
      idempotent: boolean;
    };
  }

  static prepareUsdtPayout(withdrawal: Pick<AdminWithdrawal, 'id' | 'walletAddress' | 'usdtAmount'>): AdminPayoutPreparation {
    const withdrawalId = String(withdrawal?.id ?? '').trim();
    const recipient = String(withdrawal?.walletAddress ?? '').trim();
    const amountDisplay = String(withdrawal?.usdtAmount ?? '').trim();

    if (!withdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    if (!this.isValidEvmWalletAddress(recipient)) {
      throw new Error('Withdrawal recipient wallet is invalid.');
    }

    if (!amountDisplay || !/^\d+(\.\d{1,18})?$/.test(amountDisplay)) {
      throw new Error('Withdrawal USDT amount is invalid.');
    }

    let amountWei: bigint;
    try {
      amountWei = parseUnits(amountDisplay, USDT_DECIMALS);
    } catch {
      throw new Error('Withdrawal USDT amount precision is invalid.');
    }

    if (amountWei <= 0n) {
      throw new Error('Withdrawal USDT amount must be greater than zero.');
    }

    return {
      withdrawalId,
      recipient: recipient as `0x${string}`,
      amountWei,
      amountDisplay,
    };
  }

  static async releaseWithdrawalHold(
    withdrawalId: string,
    note?: string,
  ): Promise<void> {
    const normalizedWithdrawalId = String(withdrawalId ?? '').trim();

    if (!normalizedWithdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    await apiClient.patch(
      `/withdrawals/${encodeURIComponent(normalizedWithdrawalId)}/release-hold`,
      {
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    );
  }

  static async revalidateWithdrawalPayout(withdrawalId: string): Promise<void> {
    const normalizedWithdrawalId = String(withdrawalId ?? '').trim();

    if (!normalizedWithdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    await apiClient.patch(`/withdrawals/${withdrawalId}/revalidate-payout`);
  }

  static async rejectWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<void> {
    const normalizedWithdrawalId = String(withdrawalId ?? '').trim();
    const normalizedReason = String(reason ?? '').trim();

    if (!normalizedWithdrawalId) {
      throw new Error('Withdrawal ID is required.');
    }

    if (!normalizedReason) {
      throw new Error('Rejection reason is required.');
    }

    await apiClient.patch(
      `/withdrawals/${encodeURIComponent(normalizedWithdrawalId)}/reject`,
      {
        reason: normalizedReason,
      },
    );
  }

  static isValidEvmWalletAddress(
    address: string | undefined | null,
  ): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(String(address ?? '').trim());
  }

  // ============================================================
  // ERROR HANDLING & HELPERS
  // ============================================================

  static getErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const payload = error.response?.data as
        | { message?: string | string[] }
        | undefined;

      const backendMessage = Array.isArray(payload?.message)
        ? payload?.message.join(', ')
        : payload?.message;

      if (status === 401) {
        return 'Authentication expired. Please reconnect and login again.';
      }

      if (status === 403) {
        return 'Admin access required. You are not allowed to view this dashboard.';
      }

      return backendMessage || 'Failed to load admin dashboard metrics.';
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Failed to load admin dashboard metrics.';
  }

  private static toMetricValue(value: number | null | undefined): string | number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return NA;
    }

    return value;
  }

  private static toFiniteNumber(
    value: unknown,
    fallback: number,
  ): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    return fallback;
  }

  private static normalizeWithdrawalFilterStatus(
    status: AdminWithdrawalFilterStatus | undefined,
  ): AdminWithdrawalFilterStatus | undefined {
    if (!status) return undefined;

    return this.WITHDRAWAL_STATUS_FILTERS.has(status) ? status : undefined;
  }

  private static normalizeDepositFilterStatus(
    status: AdminDepositFilterStatus | undefined,
  ): AdminDepositFilterStatus | undefined {
    if (!status) return undefined;

    return this.DEPOSIT_STATUS_FILTERS.has(status) ? status : undefined;
  }

  private static normalizeUserFilterStatus(
    status: AdminUserFilterStatus | undefined,
  ): AdminUserFilterStatus | undefined {
    if (!status) return undefined;

    return this.USER_STATUS_FILTERS.has(status) ? status : undefined;
  }

  private static normalizeLedgerFilterType(
    type: AdminLedgerFilterType | undefined,
  ): AdminLedgerFilterType | undefined {
    if (!type) return undefined;

    return this.LEDGER_TYPE_FILTERS.has(type) ? type : undefined;
  }

  private static normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return 20;
    }

    return Math.max(1, Math.min(100, Math.floor(limit)));
  }

  private static normalizeOffset(offset: number | undefined): number {
    if (typeof offset !== 'number' || !Number.isFinite(offset)) {
      return 0;
    }

    return Math.max(0, Math.floor(offset));
  }

  private static normalizeSearch(search: string | undefined): string | undefined {
    if (typeof search !== 'string') return undefined;

    const trimmed = search.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private static normalizePulseTradeStatus(
    status: AdminPulseTradeFilterStatus | undefined,
  ): AdminPulseTradeFilterStatus | undefined {
    if (!status) return undefined;

    return this.PULSE_TRADE_STATUS_FILTERS.has(status) ? status : undefined;
  }

  private static normalizePulseTradeDirection(
    direction: AdminPulseTradeFilterDirection | undefined,
  ): AdminPulseTradeFilterDirection | undefined {
    if (!direction) return undefined;

    return this.PULSE_TRADE_DIRECTION_FILTERS.has(direction) ? direction : undefined;
  }

  private static normalizePulseTradeResult(
    result: AdminPulseTradeFilterResult | undefined,
  ): AdminPulseTradeFilterResult | undefined {
    if (!result) return undefined;

    return this.PULSE_TRADE_RESULT_FILTERS.has(result) ? result : undefined;
  }

  private static normalizePulseTradeSymbol(symbol: string | undefined): string | undefined {
    const normalized = this.normalizeSearch(symbol);
    return normalized ? normalized.toUpperCase() : undefined;
  }

  private static normalizePulseTradeDuration(
    duration: AdminPulseTradeQuery['duration'] | undefined,
  ): string | undefined {
    const normalized = this.normalizeSearch(duration);
    return normalized ? normalized.toUpperCase() : undefined;
  }

  private static normalizeDateString(value: string | undefined): string | undefined {
    const normalized = this.normalizeSearch(value);

    if (!normalized) return undefined;

    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? undefined : normalized;
  }

  private static isRiskSecurityAuditLog(log: AdminAuditLogEntry): boolean {
    const action = log.action.trim().toLowerCase();
    const targetType = log.targetType.trim().toLowerCase();

    return action.includes('risk')
      || action.includes('security')
      || action.includes('settlement')
      || targetType.includes('risk')
      || targetType.includes('security')
      || targetType.includes('settlement');
  }

  private static sumStatuses(
    stats: Record<string, number>,
    statuses: string[],
  ): number | string {
    const count = statuses.reduce((sum, status) => {
      const value = stats[status];
      return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum;
    }, 0);

    return Number.isFinite(count) ? count : NA;
  }

  private static async safeFetch<T>(
    source: AdminMetricApiSource,
    fetcher: () => Promise<T>,
  ): Promise<ApiFetchResult<T>> {
    try {
      const data = await fetcher();
      return { ok: true, data };
    } catch (error) {
      const message = this.getErrorMessage(error);

      if (
        source === 'users'
        || source === 'deposits'
        || source === 'withdrawals'
        || source === 'pulseLiquidity'
        || source === 'pulseTrades'
      ) {
        return { ok: false, error: message };
      }

      return { ok: false, error: NO_AUTHORITATIVE_API };
    }
  }

  private static resolveUserMetricAvailability(
    usersResult: ApiFetchResult<AdminUserDashboardMetricsResponse>,
    usersError?: string,
  ): Record<AdminUserMetricKey, AdminMetricAvailability> {
    if (usersResult.ok) {
      return {
        ...DEFAULT_USER_METRIC_AVAILABILITY,
        ...usersResult.data.availability,
      };
    }

    if (!usersError) {
      return DEFAULT_USER_METRIC_AVAILABILITY;
    }

    return {
      totalUsers: { available: false, reason: usersError },
      activeUsers24h: { available: false, reason: usersError },
      newUsersToday: { available: false, reason: usersError },
      newUsers7d: { available: false, reason: usersError },
      newUsers30d: { available: false, reason: usersError },
      suspendedUsers: { available: false, reason: usersError },
      inactiveUsers: { available: false, reason: usersError },
      tradingUsers: { available: false, reason: usersError },
    };
  }

  private static formatTokenAmount(
    value: string | number | null | undefined,
    symbol: 'TDX' | 'USDT',
  ): string {
    if (value === null || value === undefined) {
      return NA;
    }

    const input = String(value).trim();
    if (!/^[-+]?\d+(\.\d+)?$/.test(input)) {
      return NA;
    }

    const normalized = input.startsWith('+') ? input.slice(1) : input;
    const negative = normalized.startsWith('-');
    const absValue = negative ? normalized.slice(1) : normalized;
    const [rawIntPart, rawDecimalPart = ''] = absValue.split('.');

    const intPart = rawIntPart.replace(/^0+(?=\d)/, '') || '0';
    const decimalPart = (rawDecimalPart + '00').slice(0, 2);
    const groupedIntPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sign = negative ? '-' : '';

    return `${sign}${groupedIntPart}.${decimalPart} ${symbol}`;
  }

  private static normalizeStatisticsPayload<T extends object>(
    payload: AdminApiEnvelope<T> | T | null | undefined,
    endpoint: string,
  ): T {
    if (this.isApiEnvelope<T>(payload)) {
      if (
        payload.success === true
        && payload.data
        && typeof payload.data === 'object'
      ) {
        return payload.data;
      }

      throw new Error(`Invalid statistics envelope received from ${endpoint}`);
    }

    if (payload && typeof payload === 'object') {
      return payload;
    }

    throw new Error(`Invalid statistics payload received from ${endpoint}`);
  }

  private static isApiEnvelope<T extends object>(payload: unknown): payload is AdminApiEnvelope<T> {
    return (
      typeof payload === 'object'
      && payload !== null
      && 'success' in payload
      && 'data' in payload
    );
  }

  private static formatVaultBalance(vault: { balance: string | null; symbol: string }): string {
    if (vault.balance === null || vault.balance === undefined) {
      return NA;
    }

    return this.formatTokenAmount(vault.balance, vault.symbol === 'TDX' ? 'TDX' : 'USDT');
  }

  private static getUnavailableVaultMetric(): {
    balance: string | null;
    symbol: string;
    chainId: number | null;
    address: string | null;
    tokenAddress: string | null;
    fetchedAt: string;
    available: boolean;
    error: string;
  } {
    return {
      balance: null,
      symbol: 'USDT',
      chainId: null,
      address: null,
      tokenAddress: null,
      fetchedAt: new Date().toISOString(),
      available: false,
      error: 'Statistics unavailable',
    };
  }
}