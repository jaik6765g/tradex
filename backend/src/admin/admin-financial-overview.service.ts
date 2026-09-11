// backend/src/admin/admin-financial-overview.service.ts
//
// ============================================================
// ADMIN FINANCIAL OVERVIEW SERVICE
// ============================================================
//
// SINGLE source of truth aggregation for the Admin Overview screen.
//
// DATA SOURCE MAP (no duplicates, no estimates):
//
//   All Users TDX (total/available/locked)
//     -> `balances` table (SUM over all user balance rows)
//
//   Lifetime user deposits / withdrawals (TDX)
//     -> `ledger_entries` (type = 'DEPOSIT' | 'WITHDRAWAL')
//
//   Platform Liquidity Pool CURRENT (shared by Pulse Trade + Lotto)
//     -> `admin_settings` key 'PULSE_LIQUIDITY_POOL_BALANCE'
//        (the authoritative pool read by PulseTradeService AND
//         LottoService - they share ONE pool, so they are NEVER
//         counted as two separate pools)
//
//   Reserved / Used liquidity (open pulse exposure)
//     -> SUM(pulse_trades.amount) WHERE status IN ACTIVE_SETTLEMENT_STATUSES
//
//   Admin-added liquidity (ADD / REMOVE history)
//     -> `admin_audit_logs` action = 'PULSE_LIQUIDITY_ADJUSTMENT'
//        metadata: { action, amount, result, ... }
//
//   Bot Trade liquidity
//     -> `bot_wallets` (available/locked/total)
//        inflow  -> `bot_wallet_transactions` type 'TRANSFER_IN'
//        deployed-> `bot_activations.liquidity_amount` status 'active'
//
//   Lotto fee / revenue pool
//     -> `admin_pool` (totalBalance / totalDeposited / totalWithdrawn)
//
//   On-chain vault balances (USDT)
//     -> NOT here: existing endpoints
//        /deposits/admin/statistics + /withdrawals/admin/statistics
//
//   On-chain TDX
//     -> NOT AVAILABLE (TDX is internal accounting; no TDX token is
//        deployed/configured). The screen shows N/A - never a guess.
//
// ACCOUNTING RULES:
//   - User TDX and platform funds are NEVER mixed.
//   - A TDX unit exists in exactly ONE of these DB stores:
//       user balances | platform pool | bot wallets | lotto fee pool
//     so Total Tracked TDX = sum of all four without double counting.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';

import { Balance } from '../balances/balance.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { Trade } from '../pulse-trade/entities/trade.entity';
import { ACTIVE_SETTLEMENT_STATUSES } from '../pulse-trade/constants/trade-status.constants';
import { BotWallet } from '../bot/entities/bot-wallet.entity';
import {
  BotActivation,
  BotActivationStatus,
} from '../bot/entities/bot-activation.entity';
import {
  BotWalletTransaction,
  BotWalletTransactionStatus,
  BotWalletTransactionType,
} from '../bot/entities/bot-wallet-transaction.entity';
import { AdminPool } from '../modules/lotto/entities/admin-pool.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminSetting } from './entities/admin-setting.entity';

const PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY = 'PULSE_LIQUIDITY_POOL_BALANCE';
const PULSE_LIQUIDITY_AUDIT_ACTION = 'PULSE_LIQUIDITY_ADJUSTMENT';
const PULSE_LIQUIDITY_AUDIT_TARGET_TYPE = 'pulse_liquidity';

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
  usersTdx: FinancialOverviewSection<UsersTdxData>;
  userLedger: FinancialOverviewSection<UserLedgerData>;
  platformPool: FinancialOverviewSection<PlatformPoolData>;
  adminLiquidity: FinancialOverviewSection<AdminLiquidityData>;
  botLiquidity: FinancialOverviewSection<BotLiquidityData>;
  lottoFeePool: FinancialOverviewSection<LottoFeePoolData>;
  totals: {
    // SUM(users.total) - source: balances
    allUsersTdx: string | null;
    // platform pool current + bot wallets total - source: admin_settings + bot_wallets
    platformLiquidityTdx: string | null;
    // platform liquidity + lotto fee pool - source: + admin_pool
    platformOwnedTdx: string | null;
    // users + platformOwned - the full DB-tracked TDX economy
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

interface UsersTdxData {
  accountsCount: number;
  totalTdx: string;
  availableTdx: string;
  lockedTdx: string;
  withdrawalLockedTdx: string;
  gameLockedTdx: string;
  tradingLockedTdx: string;
}

interface UserLedgerData {
  lifetimeDepositedTdx: string;
  lifetimeWithdrawnTdx: string;
  depositCount: number;
  withdrawalCount: number;
}

interface PlatformPoolData {
  currentTdx: string;
  reservedTdx: string;
  availableTdx: string;
  utilizationPercent: number;
  riskState: string;
  status: FinancialPoolStatus;
}

interface AdminLiquidityData {
  addedTdx: string;
  removedTdx: string;
  netAddedTdx: string;
  adjustmentsCount: number;
  lastAdjustmentAt: string | null;
  status: FinancialPoolStatus;
}

interface BotLiquidityData {
  walletsCount: number;
  totalTdx: string;
  availableTdx: string;
  lockedTdx: string;
  // Bot ledger sub-metrics: null = DB source currently unavailable
  // (bot module schema drift) - rendered as N/A, never a fake 0.
  inflowTdx: string | null;
  deployedTdx: string | null;
  activeActivations: number | null;
  status: FinancialPoolStatus;
}

interface LottoFeePoolData {
  totalTdx: string;
  availableTdx: string;
  lockedTdx: string;
  collectedTdx: string;
  withdrawnTdx: string;
  status: FinancialPoolStatus;
}

const toDecimal = (value: unknown): Decimal => {
  try {
    const parsed = new Decimal(String(value ?? '0'));
    return parsed.isFinite() ? Decimal.max(parsed, 0) : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};

const fixed = (value: Decimal): string => value.toFixed(18);

const toInt = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

@Injectable()
export class AdminFinancialOverviewService {
  private readonly logger = new Logger(AdminFinancialOverviewService.name);

  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(BotWallet)
    private readonly botWalletRepo: Repository<BotWallet>,
    @InjectRepository(BotActivation)
    private readonly botActivationRepo: Repository<BotActivation>,
    @InjectRepository(BotWalletTransaction)
    private readonly botWalletTransactionRepo: Repository<BotWalletTransaction>,
    @InjectRepository(AdminPool)
    private readonly adminPoolRepo: Repository<AdminPool>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepo: Repository<AdminSetting>,
  ) {}

  async getFinancialOverview(): Promise<AdminFinancialOverviewResponse> {
    const sections = await Promise.all([
      this.getUsersTdx().catch((error) =>
        this.failedSection('balances table (user balance aggregation)', error),
      ),
      this.getUserLedger().catch((error) =>
        this.failedSection('ledger_entries (DEPOSIT/WITHDRAWAL)', error),
      ),
      this.getPlatformPool().catch((error) =>
        this.failedSection(
          "admin_settings 'PULSE_LIQUIDITY_POOL_BALANCE' + pulse_trades exposure",
          error,
        ),
      ),
      this.getAdminLiquidity().catch((error) =>
        this.failedSection(
          "admin_audit_logs 'PULSE_LIQUIDITY_ADJUSTMENT' (admin liquidity ledger)",
          error,
        ),
      ),
      this.getBotLiquidity().catch((error) =>
        this.failedSection(
          'bot_wallets + bot_wallet_transactions + bot_activations',
          error,
        ),
      ),
      this.getLottoFeePool().catch((error) =>
        this.failedSection('admin_pool (lotto fee/revenue pool)', error),
      ),
    ]);

    const [
      usersTdx,
      userLedger,
      platformPool,
      adminLiquidity,
      botLiquidity,
      lottoFeePool,
    ] = sections as [
      FinancialOverviewSection<UsersTdxData>,
      FinancialOverviewSection<UserLedgerData>,
      FinancialOverviewSection<PlatformPoolData>,
      FinancialOverviewSection<AdminLiquidityData>,
      FinancialOverviewSection<BotLiquidityData>,
      FinancialOverviewSection<LottoFeePoolData>,
    ];

    const recentLiquidityActivity = await this.getRecentLiquidityActivity().catch(
      (error) => {
        this.logger.warn(`Recent liquidity activity unavailable: ${error}`);
        return [];
      },
    );

    // --------------------------------------------------------
    // CONSOLIDATED TOTALS - computed only from available sections.
    // User funds are NEVER mixed into platform liquidity:
    //   platform liquidity = platform pool + bot wallets
    //   platform owned     = platform liquidity + lotto fee pool
    //   total tracked      = platform owned + all users TDX
    // --------------------------------------------------------
    const sources: string[] = [];
    let allUsersTdx: Decimal | null = null;
    if (usersTdx.available && usersTdx.data) {
      allUsersTdx = toDecimal(usersTdx.data.totalTdx);
      sources.push(usersTdx.source);
    }

    let platformLiquidityTdx: Decimal | null = null;
    if (platformPool.available && platformPool.data) {
      platformLiquidityTdx = toDecimal(platformPool.data.currentTdx);
      sources.push(platformPool.source);
    }
    if (botLiquidity.available && botLiquidity.data) {
      platformLiquidityTdx = (platformLiquidityTdx ?? new Decimal(0)).plus(
        toDecimal(botLiquidity.data.totalTdx),
      );
      if (!sources.includes(botLiquidity.source)) sources.push(botLiquidity.source);
    }

    let platformOwnedTdx: Decimal | null =
      platformLiquidityTdx === null ? null : new Decimal(platformLiquidityTdx);
    if (lottoFeePool.available && lottoFeePool.data) {
      platformOwnedTdx = (platformOwnedTdx ?? new Decimal(0)).plus(
        toDecimal(lottoFeePool.data.totalTdx),
      );
      if (!sources.includes(lottoFeePool.source)) sources.push(lottoFeePool.source);
    }

    const totalTrackedTdx: Decimal | null =
      platformOwnedTdx === null || allUsersTdx === null
        ? null
        : platformOwnedTdx.plus(allUsersTdx);

    return {
      fetchedAt: new Date().toISOString(),
      usersTdx,
      userLedger,
      platformPool,
      adminLiquidity,
      botLiquidity,
      lottoFeePool,
      totals: {
        allUsersTdx: allUsersTdx === null ? null : fixed(allUsersTdx),
        platformLiquidityTdx:
          platformLiquidityTdx === null ? null : fixed(platformLiquidityTdx),
        platformOwnedTdx:
          platformOwnedTdx === null ? null : fixed(platformOwnedTdx),
        totalTrackedTdx:
          totalTrackedTdx === null ? null : fixed(totalTrackedTdx),
        sources,
      },
      recentLiquidityActivity,
    };
  }

  // ============================================================
  // ALL USERS TDX - source: balances table
  // ============================================================

  private async getUsersTdx(): Promise<FinancialOverviewSection<UsersTdxData>> {
    const source = 'balances table (user balance aggregation)';

    const row = await this.balanceRepo
      .createQueryBuilder('balance')
      .select('COALESCE(SUM(balance.totalBalance), 0)', 'totalTdx')
      .addSelect('COALESCE(SUM(balance.availableBalance), 0)', 'availableTdx')
      .addSelect('COALESCE(SUM(balance.lockedBalance), 0)', 'lockedTdx')
      .addSelect('COALESCE(SUM(balance.withdrawalLocked), 0)', 'withdrawalLockedTdx')
      .addSelect('COALESCE(SUM(balance.gameLocked), 0)', 'gameLockedTdx')
      .addSelect('COALESCE(SUM(balance.tradingLocked), 0)', 'tradingLockedTdx')
      .addSelect('COUNT(balance.id)', 'accountsCount')
      .getRawOne<{
        totalTdx: string;
        availableTdx: string;
        lockedTdx: string;
        withdrawalLockedTdx: string;
        gameLockedTdx: string;
        tradingLockedTdx: string;
        accountsCount: string;
      }>();

    return {
      available: true,
      source,
      data: {
        accountsCount: toInt(row?.accountsCount),
        totalTdx: fixed(toDecimal(row?.totalTdx)),
        availableTdx: fixed(toDecimal(row?.availableTdx)),
        lockedTdx: fixed(toDecimal(row?.lockedTdx)),
        withdrawalLockedTdx: fixed(toDecimal(row?.withdrawalLockedTdx)),
        gameLockedTdx: fixed(toDecimal(row?.gameLockedTdx)),
        tradingLockedTdx: fixed(toDecimal(row?.tradingLockedTdx)),
      },
    };
  }

  // ============================================================
  // USER LEDGER - source: ledger_entries (DEPOSIT / WITHDRAWAL)
  // ============================================================

  private async getUserLedger(): Promise<FinancialOverviewSection<UserLedgerData>> {
    const source = 'ledger_entries (DEPOSIT / WITHDRAWAL)';

    const row = await this.ledgerRepo
      .createQueryBuilder('entry')
      .select(
        `COALESCE(SUM(CASE WHEN entry.type = '${LedgerType.DEPOSIT}' THEN entry.amount ELSE 0 END), 0)`,
        'deposited',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN entry.type = '${LedgerType.WITHDRAWAL}' THEN entry.amount ELSE 0 END), 0)`,
        'withdrawn',
      )
      .addSelect(
        `COUNT(CASE WHEN entry.type = '${LedgerType.DEPOSIT}' THEN 1 END)`,
        'depositCount',
      )
      .addSelect(
        `COUNT(CASE WHEN entry.type = '${LedgerType.WITHDRAWAL}' THEN 1 END)`,
        'withdrawalCount',
      )
      .getRawOne<{
        deposited: string;
        withdrawn: string;
        depositCount: string;
        withdrawalCount: string;
      }>();

    return {
      available: true,
      source,
      data: {
        lifetimeDepositedTdx: fixed(toDecimal(row?.deposited)),
        lifetimeWithdrawnTdx: fixed(toDecimal(row?.withdrawn)),
        depositCount: toInt(row?.depositCount),
        withdrawalCount: toInt(row?.withdrawalCount),
      },
    };
  }

  // ============================================================
  // PLATFORM LIQUIDITY POOL
  // source: admin_settings 'PULSE_LIQUIDITY_POOL_BALANCE'
  //         (SHARED by Pulse Trade AND Lotto - one pool only)
  // reserved: SUM(pulse_trades.amount) open exposure
  // ============================================================

  private async getPlatformPool(): Promise<FinancialOverviewSection<PlatformPoolData>> {
    const source =
      "admin_settings 'PULSE_LIQUIDITY_POOL_BALANCE' + SUM(pulse_trades.amount open exposure)";

    const setting = await this.adminSettingRepo.findOne({
      where: { key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY },
    });

    const exposureRow = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.amount), 0)', 'openExposure')
      .where('trade.status IN (:...openStatuses)', {
        openStatuses: ACTIVE_SETTLEMENT_STATUSES,
      })
      .getRawOne<{ openExposure: string }>();

    const current = toDecimal(setting?.value ?? '0');
    const reserved = toDecimal(exposureRow?.openExposure ?? '0');
    const available = Decimal.max(current.minus(reserved), 0);

    const utilizationPercent = current.lte(0)
      ? 0
      : reserved.mul(100).div(current).toDecimalPlaces(2).toNumber();

    // Risk thresholds mirror PulseTradeService.getLiquidity()
    const riskState =
      utilizationPercent >= 90
        ? 'CRITICAL'
        : utilizationPercent >= 80
          ? 'HIGH'
          : utilizationPercent >= 70
            ? 'WARNING'
            : 'NORMAL';

    const status: FinancialPoolStatus =
      current.lte(0)
        ? 'EMPTY'
        : riskState === 'CRITICAL' || riskState === 'HIGH'
          ? 'LOW'
          : riskState === 'WARNING'
            ? 'WARNING'
            : 'ACTIVE';

    return {
      available: true,
      source,
      data: {
        currentTdx: fixed(current),
        reservedTdx: fixed(reserved),
        availableTdx: fixed(available),
        utilizationPercent,
        riskState,
        status,
      },
    };
  }

  // ============================================================
  // ADMIN ADDED LIQUIDITY
  // source: admin_audit_logs action 'PULSE_LIQUIDITY_ADJUSTMENT'
  // (this is the actual admin liquidity ledger in the DB)
  // ============================================================

  private async getAdminLiquidity(): Promise<FinancialOverviewSection<AdminLiquidityData>> {
    const source =
      "admin_audit_logs action 'PULSE_LIQUIDITY_ADJUSTMENT' (admin liquidity ledger)";

    const row = await this.adminAuditLogRepo
      .createQueryBuilder('log')
      .select(
        `COALESCE(SUM(CASE WHEN log.metadata->>'action' = 'ADD' AND COALESCE(log.metadata->>'result', 'SUCCESS') = 'SUCCESS' THEN (log.metadata->>'amount')::numeric ELSE 0 END), 0)`,
        'added',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN log.metadata->>'action' = 'REMOVE' AND COALESCE(log.metadata->>'result', 'SUCCESS') = 'SUCCESS' THEN (log.metadata->>'amount')::numeric ELSE 0 END), 0)`,
        'removed',
      )
      .addSelect('COUNT(log.id)', 'adjustmentsCount')
      .where('log.action = :action', { action: PULSE_LIQUIDITY_AUDIT_ACTION })
      .andWhere('log.targetType = :targetType', {
        targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
      })
      .getRawOne<{
        added: string;
        removed: string;
        adjustmentsCount: string;
      }>();

    const last = await this.adminAuditLogRepo.findOne({
      where: {
        action: PULSE_LIQUIDITY_AUDIT_ACTION,
        targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
      },
      order: { createdAt: 'DESC' },
    });

    const added = toDecimal(row?.added);
    const removed = toDecimal(row?.removed);
    const net = added.minus(removed);

    const status: FinancialPoolStatus = net.lte(0)
      ? net.eq(0)
        ? 'EMPTY'
        : 'WARNING'
      : 'ACTIVE';

    return {
      available: true,
      source,
      data: {
        addedTdx: fixed(added),
        removedTdx: fixed(removed),
        netAddedTdx: fixed(net),
        adjustmentsCount: toInt(row?.adjustmentsCount),
        lastAdjustmentAt: last ? last.createdAt.toISOString() : null,
        status,
      },
    };
  }

  // ============================================================
  // BOT TRADE LIQUIDITY
  // source: bot_wallets + bot_wallet_transactions + bot_activations
  // ============================================================

  private async getBotLiquidity(): Promise<FinancialOverviewSection<BotLiquidityData>> {
    const source =
      "bot_wallets + bot_wallet_transactions 'TRANSFER_IN' + bot_activations liquidity";

    const walletRow = await this.botWalletRepo
      .createQueryBuilder('wallet')
      .select('COALESCE(SUM(wallet.totalBalance), 0)', 'totalTdx')
      .addSelect('COALESCE(SUM(wallet.availableBalance), 0)', 'availableTdx')
      .addSelect('COALESCE(SUM(wallet.lockedBalance), 0)', 'lockedTdx')
      .addSelect('COUNT(wallet.id)', 'walletsCount')
      .getRawOne<{
        totalTdx: string;
        availableTdx: string;
        lockedTdx: string;
        walletsCount: string;
      }>();

    // ------------------------------------------------------------
    // Bot ledger sub-metrics are guarded individually: the live DB
    // has pre-existing schema drift on the bot module
    // (bot_wallet_transactions.status and bot_activations.liquidity_amount
    // do not exist in the current database). A drift in these ledger
    // sources must NOT (a) fail the real bot wallet balances or
    // (b) fabricate a zero. null => N/A on the screen.
    // ------------------------------------------------------------
    let inflowRow: { inflow: string } | null = null;
    let inflowUnavailableReason: string | null = null;
    try {
      inflowRow = await this.botWalletTransactionRepo
        .createQueryBuilder('tx')
        .select('COALESCE(SUM(tx.amount), 0)', 'inflow')
        .where('tx.type = :type', { type: BotWalletTransactionType.TRANSFER_IN })
        .andWhere('tx.status = :status', {
          status: BotWalletTransactionStatus.COMPLETED,
        })
        .getRawOne<{ inflow: string }>()
        .then((row) => row ?? null);
    } catch (error) {
      inflowUnavailableReason =
        error instanceof Error ? error.message : 'inflow source unavailable';
    }

    let deploymentRow: { deployed: string; activeActivations: string } | null =
      null;
    let deploymentUnavailableReason: string | null = null;
    try {
      deploymentRow = await this.botActivationRepo
        .createQueryBuilder('activation')
        .select('COALESCE(SUM(activation.liquidityAmount), 0)', 'deployed')
        .addSelect('COUNT(activation.id)', 'activeActivations')
        .where('activation.status = :status', {
          status: BotActivationStatus.ACTIVE,
        })
        .getRawOne<{ deployed: string; activeActivations: string }>()
        .then((row) => row ?? null);
    } catch (error) {
      deploymentUnavailableReason =
        error instanceof Error ? error.message : 'deployment source unavailable';
    }

    const total = toDecimal(walletRow?.totalTdx);
    const available = toDecimal(walletRow?.availableTdx);

    const status: FinancialPoolStatus =
      total.lte(0)
        ? 'EMPTY'
        : available.lte(0)
          ? 'LOW'
          : available.lte(total.mul(0.1))
            ? 'LOW'
            : 'ACTIVE';

    const unavailableReasons =
      [inflowUnavailableReason, deploymentUnavailableReason]
        .filter((reason): reason is string => reason !== null)
        .join(' | ');

    return {
      available: true,
      source,
      error: unavailableReasons === '' ? undefined : unavailableReasons,
      data: {
        walletsCount: toInt(walletRow?.walletsCount),
        totalTdx: fixed(total),
        availableTdx: fixed(available),
        lockedTdx: fixed(toDecimal(walletRow?.lockedTdx)),
        inflowTdx:
          inflowRow === null ? null : fixed(toDecimal(inflowRow.inflow)),
        deployedTdx:
          deploymentRow === null
            ? null
            : fixed(toDecimal(deploymentRow.deployed)),
        activeActivations:
          deploymentRow === null
            ? null
            : toInt(deploymentRow.activeActivations),
        status,
      },
    };
  }

  // ============================================================
  // LOTTO FEE / REVENUE POOL - source: admin_pool
  // (platform revenue collected from lotto tickets - NOT part of
  //  the payout liquidity pool, shown separately to avoid double
  //  counting)
  // ============================================================

  private async getLottoFeePool(): Promise<FinancialOverviewSection<LottoFeePoolData>> {
    const source = 'admin_pool (lotto fee/revenue pool)';

    const pool = await this.adminPoolRepo
      .createQueryBuilder('pool')
      .orderBy('pool.id', 'ASC')
      .getOne();

    const total = toDecimal(pool?.totalBalance ?? '0');
    const available = toDecimal(pool?.availableBalance ?? '0');

    const status: FinancialPoolStatus = total.lte(0)
      ? 'EMPTY'
      : available.lte(0)
        ? 'LOW'
        : 'ACTIVE';

    return {
      available: true,
      source,
      data: {
        totalTdx: fixed(total),
        availableTdx: fixed(available),
        lockedTdx: fixed(toDecimal(pool?.lockedBalance ?? '0')),
        collectedTdx: fixed(toDecimal(pool?.totalDeposited ?? '0')),
        withdrawnTdx: fixed(toDecimal(pool?.totalWithdrawn ?? '0')),
        status,
      },
    };
  }

  // ============================================================
  // RECENT LIQUIDITY ACTIVITY
  // source: admin_audit_logs 'PULSE_LIQUIDITY_ADJUSTMENT'
  // ============================================================

  private async getRecentLiquidityActivity(): Promise<
    AdminFinancialOverviewResponse['recentLiquidityActivity']
  > {
    const rows = await this.adminAuditLogRepo.find({
      where: {
        action: PULSE_LIQUIDITY_AUDIT_ACTION,
        targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return rows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;

      return {
        id: row.id,
        date: row.createdAt.toISOString(),
        type:
          String(metadata.action ?? '').toUpperCase() === 'REMOVE'
            ? ('REMOVE' as const)
            : ('ADD' as const),
        amountTdx: fixed(toDecimal(metadata.amount)),
        source: 'ADMIN_LIQUIDITY',
        status:
          String(metadata.result ?? '').toUpperCase() === 'FAILED'
            ? ('FAILED' as const)
            : ('SUCCESS' as const),
        adminId: row.adminId,
        reason: String(metadata.reason ?? ''),
      };
    });
  }

  private failedSection(
    source: string,
    error: unknown,
  ): FinancialOverviewSection<never> {
    this.logger.warn(
      `Financial overview section unavailable (${source}): ${error}`,
    );
    return {
      available: false,
      source,
      error: error instanceof Error ? error.message : 'Source unavailable',
    };
  }
}
