import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  Like,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { Balance } from '../../balances/balance.entity';
import { LedgerEntry, LedgerType } from '../../ledger/ledger.entity';
import {
  normalizePulseSymbol,
  PULSE_30S_CUTOFF_SECONDS,
  PULSE_30S_DURATION_SECONDS,
  pulseDurationCodeToSeconds,
  pulseDurationSecondsToCode,
  PULSE_MAX_TRADE_AMOUNT_TDX,
  PULSE_MIN_TRADE_AMOUNT_TDX,
  PULSE_SUPPORTED_DURATION_CODES,
  PULSE_SUPPORTED_PAIRS,
  PulseSupportedDurationCode,
  PulseSupportedDurationSeconds,
  PulseSupportedPair,
  isSupportedPulseDurationCode,
  isSupportedPulsePair,
} from '../constants/trade-config';
import { PULSE_SETTLEMENT_POLICY } from '../constants/settlement-policy';
import { TradeDirection, TradeResult, TradeStatus } from '../constants/enums';
import { AdminAdjustLiquidityDto } from '../dtos/admin-adjust-liquidity.dto';
import { AdminLiquidityActivityQueryDto } from '../dtos/admin-liquidity-activity-query.dto';
import { PlaceTradeDto } from '../dtos/place-trade.dto';
import { TradeHistoryQueryDto } from '../dtos/trade-history-query.dto';
import { Trade } from '../entities/trade.entity';
import { User } from '../../users/user.entity';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { AdminSetting } from '../../admin/entities/admin-setting.entity';
import { PriceService } from './price-service';
import { RiskService } from './risk-service';
import { LiquidityService } from './liquidity-service';
import { ACTIVE_SETTLEMENT_STATUSES } from '../constants/trade-status.constants';
import {
  PULSE_SETTLEMENT_QUEUE,
  PULSE_SETTLEMENT_SETTLE_JOB,
  pulseSettlementTradeJobId,
} from '../workers/pulse-settlement.queue';
import { AdminSettlementRecoveryDto } from '../dtos/admin-settlement-recovery.dto';

type SupportedTradeSymbol = PulseSupportedPair;

const TERMINAL_NON_SETTLABLE_STATUSES: TradeStatus[] = [
  TradeStatus.REJECTED,
  TradeStatus.CANCELLED,
  TradeStatus.SETTLEMENT_FAILED,
];

const PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY = 'PULSE_LIQUIDITY_POOL_BALANCE';
const PULSE_LIQUIDITY_AUDIT_ACTION = 'PULSE_LIQUIDITY_ADJUSTMENT';
const PULSE_LIQUIDITY_AUDIT_TARGET_TYPE = 'pulse_liquidity';
const PULSE_SETTLEMENT_RECOVERY_AUDIT_ACTION = 'PULSE_SETTLEMENT_RECOVERY';
const PULSE_SETTLEMENT_RECOVERY_AUDIT_TARGET_TYPE = 'pulse_trade';
/**
 * HIGH-1 (TOCTOU fix): placement risk-domain advisory lock key.
 * har authoritative risk/liquidity re-check isi lock ke andar hota hai,
 * taaki concurrent placements same stale exposure par pass na ho sakein.
 */
const PULSE_PLACEMENT_RISK_LOCK_KEY = 'pulse-placement-risk';
const RISK_MAX_TOTAL_EXPOSURE_PERCENT = new Decimal('100');
const RISK_MAX_PAIR_EXPOSURE_PERCENT = new Decimal('40');
const RISK_MAX_DURATION_EXPOSURE_PERCENT = new Decimal('30');
const RISK_MAX_USER_EXPOSURE_PERCENT = new Decimal('15');

export interface PlaceTradeResult {
  trade: {
    id: string;
    symbol: string;
    direction: TradeDirection;
    duration: PulseSupportedDurationCode;
    stake: string;
    fee: string;
    netStake: string;
    entryPrice: string;
    entryAt: string;
    expiresAt: string;
    status: string;
    result: TradeResult | null;
    payout: string | null;
    remainingSeconds: number;
  };
  feeBreakdown: {
    totalFee: string;
    referral: string;
    admin: string;
    bonusVault: string;
  };
  balance: {
    available: string;
    locked: string;
    total: string;
  };
}

interface SettlementResult {
  tradeId: string;
  status: TradeStatus;
  result: TradeResult;
  entryPrice: string;
  expiryPrice: string;
  payout: string;
  settledAt: string;
}

interface TradeFeeBreakdown {
  totalFee: Decimal;
  netStake: Decimal;
  referral: Decimal;
  admin: Decimal;
  bonusVault: Decimal;
}

export interface AdminLiquidityActivityItem {
  id: string;
  adminId: string;
  action: 'ADD' | 'REMOVE';
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  reservedLiquidity: string;
  availableLiquidity: string;
  result: 'SUCCESS' | 'FAILED';
  reason: string;
  reference: string | null;
  note: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminLiquidityActivityResponse {
  items: AdminLiquidityActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

interface AdminLiquidityAdjustContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface ReferralDistributionTarget {
  level: number;
  ancestorUserId: string | null;
}

export interface SettlementRecoveryResult {
  tradeId: string;
  previousStatus: TradeStatus;
  action: 'RECOVERY_QUEUED' | 'ALREADY_SETTLED';
  status: TradeStatus;
  jobId: string | null;
}

@Injectable()
export class PulseTradeService {
  private readonly logger = new Logger(PulseTradeService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    private readonly dataSource: DataSource,
    private readonly priceService: PriceService,
    private readonly riskService: RiskService,
    private readonly liquidityService: LiquidityService,
    private readonly configService: ConfigService,
    /**
     * HIGH-3 (settlement recovery): existing deterministic settlement queue.
     * Optional — unit tests / queue-less bootstrap break na hon; queue
     * unavailable ho to recovery sirf authoritative DB reset karti hai aur
     * existing 1s expiry scan trade ko utha leta hai.
     */
    @Optional()
    @InjectQueue(PULSE_SETTLEMENT_QUEUE)
    private readonly settlementQueue?: Queue,
  ) {}

  private async getLiquidityPoolBalance(
    manager?: EntityManager,
  ): Promise<Decimal> {
    const settingsRepo = manager
      ? manager.getRepository(AdminSetting)
      : typeof this.dataSource.getRepository === 'function'
        ? this.dataSource.getRepository(AdminSetting)
        : null;

    if (!settingsRepo) {
      return new Decimal(0);
    }

    const setting = await settingsRepo.findOne({
      where: {
        key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY,
      },
    });

    if (!setting) {
      return new Decimal(0);
    }

    return Decimal.max(this.parseAmount(setting.value), 0);
  }

  private async getOrCreateLiquidityPoolSettingForUpdate(
    manager: EntityManager,
  ): Promise<AdminSetting> {
    const settingsRepo = manager.getRepository(AdminSetting);

    let setting = await settingsRepo.findOne({
      where: {
        key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY,
      },
      lock: {
        mode: 'pessimistic_write',
      },
    });

    if (setting) {
      return setting;
    }

    setting = settingsRepo.create({
      key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY,
      value: '0.000000000000000000',
      valueType: 'number',
      description:
        'Authoritative Pulse Trade platform liquidity pool balance in TDX',
      editable: true,
      updatedBy: null,
    });

    try {
      return await settingsRepo.save(setting);
    } catch (error) {
      if (!this.isLiquiditySettingUniqueViolation(error)) {
        throw error;
      }

      const retrySetting = await settingsRepo.findOne({
        where: {
          key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY,
        },
        lock: {
          mode: 'pessimistic_write',
        },
      });

      if (!retrySetting) {
        throw error;
      }

      return retrySetting;
    }
  }

  private isLiquiditySettingUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };

    return (
      driverError?.code === '23505' &&
      driverError?.constraint === 'IDX_admin_settings_key_unique'
    );
  }

  /**
   * HIGH-4: sirf unallocated-referral→liquidity index ka 23505 classify hota
   * hai. Baaki unique violations (clientRequestId, TRADE_FEE_DISTRIBUTION,
   * TRADE_FEE_ALLOCATION, TRADE_SETTLEMENT) kabhi swallow/convert nahi hote.
   */
  private isUnallocatedReferralUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };

    return (
      driverError?.code === '23505' &&
      driverError?.constraint ===
        'IDX_ledger_trade_fee_unallocated_reference_unique'
    );
  }

  /**
   * HIGH-5 (replay integrity): authoritative placement financial completeness
   * verification. Replay sirf COMPLETE hone par success hai; INCOMPLETE
   * (missing legs/records) aur INCONSISTENT (wrong amounts/duplicates/
   * contradictions) dono fail-closed hain — koi auto-repair nahi, koi
   * partial mutation nahi.
   *
   * Stable business identities use hote hain: reference_type + reference_id
   * (tradeId / `${tradeId}:L{level}:{recipient}`) + exact Decimal amounts.
   * Koi fragile global ledger count nahi.
   */
  private async verifyPlacementFinancialCompleteness(
    trade: Trade,
    userId: string,
    ledgerRepo: Repository<LedgerEntry>,
    settingRepo: Repository<AdminSetting>,
    balanceRepo: Repository<Balance>,
  ): Promise<'COMPLETE' | 'INCOMPLETE' | 'INCONSISTENT'> {
    // 1. Ownership/identity — cross-user ya corrupt identity fail-closed.
    if (trade.userId !== userId) {
      return 'INCONSISTENT';
    }
    if (!trade.amount || !trade.entryPrice || !trade.pair || !trade.expiryAt) {
      return 'INCOMPLETE';
    }

    const amount = this.parseAmount(trade.amount);
    const feeBreakdown = this.computeTradeFeeBreakdown(amount);

    // 2. Entry debit ledger — exactly once, exact gross amount.
    const entryLegs = await ledgerRepo.find({
      where: { referenceType: 'pulse_trade', referenceId: trade.id },
    });
    if (entryLegs.length === 0) {
      return 'INCOMPLETE';
    }
    if (entryLegs.length > 1) {
      return 'INCONSISTENT';
    }
    if (!this.parseAmount(entryLegs[0].amount).eq(amount)) {
      return 'INCONSISTENT';
    }

    // 3. Fee allocation ledger — exactly once, exact 5% amount.
    const feeLegs = await ledgerRepo.find({
      where: {
        referenceType: PULSE_SETTLEMENT_POLICY.ledger.feeReferenceType,
        referenceId: trade.id,
      },
    });
    if (feeLegs.length === 0) {
      return 'INCOMPLETE';
    }
    if (feeLegs.length > 1) {
      return 'INCONSISTENT';
    }
    if (!this.parseAmount(feeLegs[0].amount).eq(feeBreakdown.totalFee)) {
      return 'INCONSISTENT';
    }

    // 4. Referral legs — L1..L6 har level exactly once, exact level amount,
    // sum === referral allocation (2%). Allocated/unallocated mix
    // chain-shape agnostic hai.
    const referralLegs = await ledgerRepo.find({
      where: { referenceId: Like(`${trade.id}:L%`) },
    });
    const legsByLevel = new Map<number, LedgerEntry[]>();
    const validReferralTypes: string[] = [
      PULSE_SETTLEMENT_POLICY.ledger.feeAllocationReferenceType,
      PULSE_SETTLEMENT_POLICY.ledger
        .unallocatedReferralToLiquidityReferenceType,
    ];
    for (const leg of referralLegs) {
      if (!validReferralTypes.includes(leg.referenceType)) {
        return 'INCONSISTENT';
      }
      const match = /^[^:]+:L(\d+):/.exec(leg.referenceId ?? '');
      const level = match ? Number(match[1]) : Number.NaN;
      const levelPercent =
        PULSE_SETTLEMENT_POLICY.referral.levels[
          `L${level}` as keyof typeof PULSE_SETTLEMENT_POLICY.referral.levels
        ];
      if (!Number.isFinite(level) || levelPercent === undefined) {
        return 'INCONSISTENT';
      }
      const bucket = legsByLevel.get(level) ?? [];
      bucket.push(leg);
      legsByLevel.set(level, bucket);
    }

    let referralSum = new Decimal(0);
    for (let level = 1; level <= 6; level += 1) {
      const legs = legsByLevel.get(level) ?? [];
      if (legs.length === 0) {
        return 'INCOMPLETE';
      }
      if (legs.length > 1) {
        return 'INCONSISTENT';
      }
      const levelPercent =
        PULSE_SETTLEMENT_POLICY.referral.levels[
          `L${level}` as keyof typeof PULSE_SETTLEMENT_POLICY.referral.levels
        ] ?? '0';
      const expected = this.percentOf(amount, levelPercent);
      if (!this.parseAmount(legs[0].amount).eq(expected)) {
        return 'INCONSISTENT';
      }
      referralSum = referralSum.plus(legs[0].amount);
    }
    if (!referralSum.eq(feeBreakdown.referral)) {
      return 'INCONSISTENT';
    }

    // 5. Pool routing record — unallocated legs hon to pool setting maujood.
    const hasUnallocatedLegs = referralLegs.some(
      (leg) =>
        leg.referenceType ===
        PULSE_SETTLEMENT_POLICY.ledger
          .unallocatedReferralToLiquidityReferenceType,
    );
    if (hasUnallocatedLegs) {
      const pool = await settingRepo.findOne({
        where: { key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY },
      });
      if (!pool) {
        return 'INCOMPLETE';
      }
    }

    // 6. Balance debit agreement — unsettled trade ka stake locked hona
    // chahiye (settlement lock legitimately release karta hai).
    if (trade.status !== TradeStatus.SETTLED) {
      const balance = await balanceRepo.findOne({ where: { userId } });
      if (!balance) {
        return 'INCOMPLETE';
      }
      if (
        this.parseAmount(balance.lockedBalance).lt(amount) ||
        this.parseAmount(balance.tradingLocked).lt(amount)
      ) {
        return 'INCONSISTENT';
      }
    }

    return 'COMPLETE';
  }

  private isTerminalNonSettlableStatus(status: TradeStatus): boolean {
    return TERMINAL_NON_SETTLABLE_STATUSES.includes(status);
  }

  private async getReservedLiquidity(
    manager?: EntityManager,
  ): Promise<Decimal> {
    const tradeRepo = manager ? manager.getRepository(Trade) : this.tradeRepo;

    const openExposureRaw = await tradeRepo
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.amount), 0)', 'openExposure')
      .where('trade.status IN (:...openStatuses)', {
        openStatuses: ACTIVE_SETTLEMENT_STATUSES,
      })
      .getRawOne<{ openExposure: string }>();

    return this.parseAmount(openExposureRaw?.openExposure ?? '0');
  }

  private canQueryLiquidityActivityByReference(
    auditRepo: Repository<AdminAuditLog> | Partial<Repository<AdminAuditLog>>,
  ): auditRepo is Repository<AdminAuditLog> {
    return (
      typeof (auditRepo as { createQueryBuilder?: unknown })
        .createQueryBuilder === 'function'
    );
  }

  private async findLatestLiquidityActivityByReference(
    auditRepo: Repository<AdminAuditLog>,
    reference: string,
  ): Promise<AdminAuditLog | null> {
    return auditRepo
      .createQueryBuilder('auditLog')
      .where('auditLog.action = :action', {
        action: PULSE_LIQUIDITY_AUDIT_ACTION,
      })
      .andWhere('auditLog.targetType = :targetType', {
        targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
      })
      .andWhere(`auditLog.metadata ->> 'reference' = :reference`, {
        reference,
      })
      .orderBy('auditLog.createdAt', 'DESC')
      .getOne();
  }

  private isMatchingLiquidityAdjustmentReference(
    activity: AdminAuditLog,
    expected: {
      action: 'ADD' | 'REMOVE';
      amount: Decimal;
      reason: string;
      reference: string;
      note: string | null;
    },
  ): boolean {
    const metadata = (activity.metadata ?? {}) as Record<
      string,
      string | number | null | undefined
    >;
    const existingAction =
      String(metadata.action ?? '').toUpperCase() === 'REMOVE'
        ? 'REMOVE'
        : 'ADD';
    const existingReason = String(metadata.reason ?? '');
    const existingReference = String(metadata.reference ?? '');
    const existingNote = metadata.note ? String(metadata.note) : null;

    let existingAmount: Decimal;
    try {
      existingAmount = this.parseAmount(metadata.amount ?? '0');
    } catch {
      return false;
    }

    return (
      existingAction === expected.action &&
      existingAmount.eq(expected.amount) &&
      existingReason === expected.reason &&
      existingReference === expected.reference &&
      existingNote === expected.note
    );
  }

  private mapLiquidityActivity(
    activity: AdminAuditLog,
  ): AdminLiquidityActivityItem {
    const metadata = (activity.metadata ?? {}) as Record<
      string,
      string | number | null | undefined
    >;

    return {
      id: activity.id,
      adminId: activity.adminId,
      action:
        String(metadata.action ?? '').toUpperCase() === 'REMOVE'
          ? 'REMOVE'
          : 'ADD',
      amount: this.parseAmount(metadata.amount ?? '0').toFixed(18),
      balanceBefore: this.parseAmount(metadata.balanceBefore ?? '0').toFixed(
        18,
      ),
      balanceAfter: this.parseAmount(metadata.balanceAfter ?? '0').toFixed(18),
      reservedLiquidity: this.parseAmount(
        metadata.reservedLiquidity ?? '0',
      ).toFixed(18),
      availableLiquidity: this.parseAmount(
        metadata.availableLiquidity ?? '0',
      ).toFixed(18),
      result:
        String(metadata.result ?? '').toUpperCase() === 'FAILED'
          ? 'FAILED'
          : 'SUCCESS',
      reason: String(metadata.reason ?? ''),
      reference: metadata.reference ? String(metadata.reference) : null,
      note: metadata.note ? String(metadata.note) : null,
      ipAddress: activity.ipAddress,
      userAgent: activity.userAgent,
      createdAt: activity.createdAt.toISOString(),
    };
  }

  private async getLiquiditySnapshotForPlacement(
    pair: PulseSupportedPair,
    manager?: EntityManager,
  ): Promise<{
    availableLiquidity: string;
    reservedLiquidity: string;
    currentPayoutExposure: string;
    currentPairExposure: string;
  }> {
    try {
      const tradeRepo = manager ? manager.getRepository(Trade) : this.tradeRepo;

      const openExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'openExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .getRawOne<{ openExposure: string }>();

      const pairExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'pairExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .andWhere('trade.pair = :pair', { pair })
        .getRawOne<{ pairExposure: string }>();

      const poolBalance = await this.getLiquidityPoolBalance(manager);
      const reservedAmount = this.parseAmount(
        openExposureRaw?.openExposure ?? '0',
      );
      const pairExposure = this.parseAmount(
        pairExposureRaw?.pairExposure ?? '0',
      );
      const availableLiquidity = Decimal.max(
        poolBalance.minus(reservedAmount),
        0,
      );

      return {
        availableLiquidity: availableLiquidity.toFixed(18),
        reservedLiquidity: reservedAmount.toFixed(18),
        currentPayoutExposure: reservedAmount.toFixed(18),
        currentPairExposure: pairExposure.toFixed(18),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build liquidity snapshot for placement on ${pair}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        availableLiquidity: '0.000000000000000000',
        reservedLiquidity: '0.000000000000000000',
        currentPayoutExposure: '0.000000000000000000',
        currentPairExposure: '0.000000000000000000',
      };
    }
  }

  /**
   * HIGH-1 (TOCTOU fix): fresh, authoritative risk-exposure snapshot.
   * Ye helper SIRF placement transaction ke andar, serialization/advisory
   * lock hold karte waqt call hona chahiye — tabhi ye "authoritative" hai.
   * Snapshot queries same manager (same DB transaction / same connection)
   * par chalti hain, isliye concurrent committed placements ka effect
   * yahan dikh jata hai.
   *
   * Fail-closed: snapshot banana fail ho jaye to placement reject hota hai
   * (zeros return karna fail-open hoga jo risk ke liye galat hai).
   */
  private async getRiskSnapshotForPlacement(
    pair: PulseSupportedPair,
    durationSeconds: number,
    userId: string,
    manager: EntityManager,
  ): Promise<{
    currentTotalExposure: string;
    currentPairExposure: string;
    currentDurationExposure: string;
    currentUserExposure: string;
  }> {
    try {
      const tradeRepo = manager.getRepository(Trade);

      const totalExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'totalExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .getRawOne<{ totalExposure: string }>();

      const pairExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'pairExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .andWhere('trade.pair = :pair', { pair })
        .getRawOne<{ pairExposure: string }>();

      const durationExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'durationExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .andWhere('trade.duration = :durationSeconds', { durationSeconds })
        .getRawOne<{ durationExposure: string }>();

      const userExposureRaw = await tradeRepo
        .createQueryBuilder('trade')
        .select('COALESCE(SUM(trade.amount), 0)', 'userExposure')
        .where('trade.status IN (:...openStatuses)', {
          openStatuses: ACTIVE_SETTLEMENT_STATUSES,
        })
        .andWhere('trade.userId = :userId', { userId })
        .getRawOne<{ userExposure: string }>();

      return {
        currentTotalExposure: this.parseAmount(
          totalExposureRaw?.totalExposure ?? '0',
        ).toFixed(18),
        currentPairExposure: this.parseAmount(
          pairExposureRaw?.pairExposure ?? '0',
        ).toFixed(18),
        currentDurationExposure: this.parseAmount(
          durationExposureRaw?.durationExposure ?? '0',
        ).toFixed(18),
        currentUserExposure: this.parseAmount(
          userExposureRaw?.userExposure ?? '0',
        ).toFixed(18),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build risk snapshot for placement on ${pair}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ConflictException('RISK_SNAPSHOT_UNAVAILABLE_FOR_PLACEMENT');
    }
  }

  /**
   * HIGH-1 (TOCTOU fix): risk-domain serialization lock.
   * Project convention follow karta hai (deposit-address/sweeps jaisa):
   *   SELECT pg_advisory_xact_lock(hashtext($1)::bigint)
   * Transaction-scoped hai — commit/rollback par apne aap release ho jata
   * hai, isliye success/rejection/exception teeno cases me lock release
   * sahi hota hai. Global lock nahi hai — sirf pulse placement risk domain
   * (total/pair/duration/user exposure) ke liye hai; existing AdminSetting
   * pool row-lock liquidity serialization ke liye waise hi chalta rahega.
   */
  private canUsePlacementAdvisoryLock(manager: EntityManager): boolean {
    return typeof (manager as { query?: unknown }).query === 'function';
  }

  private canEnforcePlacementLiquidityWithLock(
    manager: EntityManager,
  ): boolean {
    const repo = manager.getRepository(AdminSetting) as Partial<
      Repository<AdminSetting>
    >;

    return (
      typeof repo.findOne === 'function' &&
      typeof repo.create === 'function' &&
      typeof repo.save === 'function'
    );
  }

  async getMarkets() {
    return {
      markets: PULSE_SUPPORTED_PAIRS.map((symbol) => ({
        symbol,
        baseAsset: symbol.split('/')[0],
        quoteAsset: symbol.split('/')[1],
        enabled: true,
        minTradeAmount: PULSE_MIN_TRADE_AMOUNT_TDX,
        maxTradeAmount: PULSE_MAX_TRADE_AMOUNT_TDX,
        durations: [...PULSE_SUPPORTED_DURATION_CODES],
      })),
    };
  }

  async getMarketPrice(symbolParam: string) {
    const symbol = this.normalizeSymbolOrThrow(symbolParam);
    const index = await this.priceService.getAuthoritativePriceIndex(symbol);

    return {
      symbol,
      price: index.indexPrice,
      source: 'AGGREGATED_INDEX',
      timestamp: index.calculatedAt.toISOString(),
      stale: false,
    };
  }

  async placeTrade(
    userId: string,
    dto: PlaceTradeDto,
  ): Promise<PlaceTradeResult> {
    const symbol = this.normalizeSymbolOrThrow(dto.symbol);
    const durationCode = this.normalizeDurationOrThrow(dto.duration);
    const durationSeconds = pulseDurationCodeToSeconds(durationCode);
    const amount = this.parsePositiveAmount(dto.amount, 'amount');
    const minAmount = new Decimal(PULSE_MIN_TRADE_AMOUNT_TDX);
    const maxAmount = new Decimal(PULSE_MAX_TRADE_AMOUNT_TDX);

    if (amount.lt(minAmount)) {
      throw new ConflictException(
        'AMOUNT_BELOW_MINIMUM: Minimum trade amount is 10 TDX',
      );
    }
    if (amount.gt(maxAmount)) {
      throw new ConflictException(
        'AMOUNT_ABOVE_MAXIMUM: Maximum trade amount is 10000 TDX',
      );
    }

    if (!dto.clientRequestId?.trim()) {
      throw new BadRequestException('clientRequestId is required');
    }

    const clientRequestId = dto.clientRequestId.trim();

    const existing = await this.tradeRepo.findOne({
      where: { userId, clientRequestId },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      // HIGH-5 (replay integrity): fast-path replay bhi financial
      // completeness verify karta hai. Authoritative decision phir bhi
      // placement transaction ke andar (advisory lock ke baad) hota hai —
      // ye sirf performance fast path hai.
      const completeness = await this.verifyPlacementFinancialCompleteness(
        existing,
        userId,
        this.dataSource.getRepository(LedgerEntry),
        this.dataSource.getRepository(AdminSetting),
        this.balanceRepo,
      );
      if (completeness !== 'COMPLETE') {
        this.logger.error(
          `Pulse placement replay rejected for trade ${existing.id}: financial state ${completeness} (fail-closed, no auto-repair)`,
        );
        throw new ConflictException(
          completeness === 'INCOMPLETE'
            ? 'PLACEMENT_REPLAY_INCOMPLETE: placement financial state is incomplete'
            : 'PLACEMENT_REPLAY_INCONSISTENT: placement financial state is inconsistent',
        );
      }
      return this.toPlaceTradeResult(
        existing,
        await this.getUserBalanceSnapshot(userId),
      );
    }

    const priceIndex =
      await this.priceService.getAuthoritativePriceIndex(symbol);

    const now = new Date();
    this.ensureDurationCutoff(now, durationSeconds);

    const risk = await this.riskService.evaluatePreTradeRisk({
      userId,
      pair: symbol,
      amount: amount.toFixed(18),
      duration: durationSeconds,
    });

    if (!risk.approved) {
      throw new ConflictException(risk.reason ?? 'RISK_LIMIT_REACHED');
    }

    // NOTE (HIGH-1): ye pre-transaction risk/liquidity checks sirf
    // performance-only fast-fail hain. AUTHORITATIVE decision niche
    // placement transaction ke andar, advisory lock hold karte hue fresh
    // exposure snapshot ke saath hota hai. Stale snapshot par koi placement
    // accept nahi hoti.

    const liquiditySnapshot =
      await this.getLiquiditySnapshotForPlacement(symbol);

    const liquidity = await this.liquidityService.checkTradeLiquidity({
      pair: symbol,
      amount: amount.toFixed(18),
      duration: durationSeconds,
      availableLiquidity: liquiditySnapshot.availableLiquidity,
      reservedLiquidity: liquiditySnapshot.reservedLiquidity,
      currentPayoutExposure: liquiditySnapshot.currentPayoutExposure,
      currentPairExposure: liquiditySnapshot.currentPairExposure,
    });

    if (!liquidity.approved) {
      throw new ConflictException(
        liquidity.reason ?? 'LIQUIDITY_LIMIT_REACHED',
      );
    }

    const feeBreakdown = this.computeTradeFeeBreakdown(amount);
    const fee = feeBreakdown.totalFee;
    const netStake = feeBreakdown.netStake;
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);

    // HIGH-2 (placement financial atomicity): poora placement — balance
    // debit, trade INSERT, entry/fee/referral ledger legs, liquidity pool
    // routing — EK HI transaction ke andar hota hai. Outcome union: normal
    // { trade } ya in-tx idempotency replay { replay }.
    let placementOutcome: { trade: Trade } | { replay: Trade };

    try {
      placementOutcome = await this.dataSource.transaction(
      async (manager) => {
        // HIGH-1 (TOCTOU fix) — step 1: risk-domain advisory lock SABSE PEHLE.
        // Project convention: pg_advisory_xact_lock(hashtext(...)).
        // Transaction-scoped hai → commit/rollback/exception par automatic
        // release. Yahi lock concurrent placements ko serialize karta hai,
        // taki niche ka fresh risk/liquidity re-check authoritative rahe.
        if (this.canUsePlacementAdvisoryLock(manager)) {
          await manager.query(
            'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
            [PULSE_PLACEMENT_RISK_LOCK_KEY],
          );
        }

        const txTradeRepo = manager.getRepository(Trade);
        const txBalanceRepo = manager.getRepository(Balance);
        const txLedgerRepo = manager.getRepository(LedgerEntry);

        // HIGH-2 (placement atomicity): in-tx idempotency re-check — advisory
        // lock ke andar, KISI bhi financial mutation se PEHLE. Pre-tx check
        // ek concurrent placement ko miss kar sakta hai jo hum lock wait
        // karte waqt commit ho chuka ho; lock ke andar padha gaya state
        // authoritative hai. Milne par seedha replay — na doosra debit, na
        // doosra trade, na duplicate fee legs (kuch bhi mutate nahi hua isliye
        // early return par rollback ka koi financial side-effect nahi).
        const inTxReplay = await txTradeRepo.findOne({
          where: { userId, clientRequestId },
        });
        if (inTxReplay) {
          // HIGH-5 (replay integrity): replay sirf tab valid hai jab poora
          // placement financial state complete + consistent ho.
          const completeness = await this.verifyPlacementFinancialCompleteness(
            inTxReplay,
            userId,
            txLedgerRepo,
            manager.getRepository(AdminSetting),
            txBalanceRepo,
          );
          if (completeness !== 'COMPLETE') {
            this.logger.error(
              `Pulse placement replay rejected for trade ${inTxReplay.id}: financial state ${completeness} (fail-closed, no auto-repair)`,
            );
            throw new ConflictException(
              completeness === 'INCOMPLETE'
                ? 'PLACEMENT_REPLAY_INCOMPLETE: placement financial state is incomplete'
                : 'PLACEMENT_REPLAY_INCONSISTENT: placement financial state is inconsistent',
            );
          }
          this.logger.log(
            `Pulse placement replayed inside transaction for user ${userId}: clientRequestId ${clientRequestId} already committed (financially verified)`,
          );
          return { replay: inTxReplay };
        }

        let balance = await txBalanceRepo.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!balance) {
          const zero = '0.000000000000000000';
          balance = txBalanceRepo.create({
            userId,
            availableBalance: zero,
            lockedBalance: zero,
            gameLocked: zero,
            tradingLocked: zero,
            withdrawalLocked: zero,
            totalBalance: zero,
          });
          balance = await txBalanceRepo.save(balance);
        }

        let liquidityPoolSettingForReferral: AdminSetting | null = null;

        if (this.canEnforcePlacementLiquidityWithLock(manager)) {
          liquidityPoolSettingForReferral =
            await this.getOrCreateLiquidityPoolSettingForUpdate(manager);

          const liquiditySnapshotInTx =
            await this.getLiquiditySnapshotForPlacement(symbol, manager);
          const liquidityInTx = await this.liquidityService.checkTradeLiquidity(
            {
              pair: symbol,
              amount: amount.toFixed(18),
              duration: durationSeconds,
              availableLiquidity: liquiditySnapshotInTx.availableLiquidity,
              reservedLiquidity: liquiditySnapshotInTx.reservedLiquidity,
              currentPayoutExposure:
                liquiditySnapshotInTx.currentPayoutExposure,
              currentPairExposure: liquiditySnapshotInTx.currentPairExposure,
            },
          );

          if (!liquidityInTx.approved) {
            throw new ConflictException(
              liquidityInTx.reason ?? 'LIQUIDITY_LIMIT_REACHED',
            );
          }
        }

        // HIGH-1 (TOCTOU fix) — authoritative RISK re-check on FRESH state.
        // Advisory lock (upar) + same-transaction snapshot queries: ye padha
        // gaya exposure concurrent committed placements ko include karta hai.
        // Fail hone par yahin reject — balance/trade/fee ka koi mutation nahi
        // hua (poora tx rollback hota hai).
        const riskSnapshotInTx = await this.getRiskSnapshotForPlacement(
          symbol,
          durationSeconds,
          userId,
          manager,
        );
        const riskInTx = await this.riskService.evaluatePreTradeRisk({
          userId,
          pair: symbol,
          amount: amount.toFixed(18),
          duration: durationSeconds,
          currentTotalExposure: riskSnapshotInTx.currentTotalExposure,
          currentPairExposure: riskSnapshotInTx.currentPairExposure,
          currentDurationExposure: riskSnapshotInTx.currentDurationExposure,
          currentUserExposure: riskSnapshotInTx.currentUserExposure,
        });

        if (!riskInTx.approved) {
          throw new ConflictException(
            riskInTx.reason ?? 'RISK_LIMIT_REACHED',
          );
        }

        const availableBefore = this.parseAmount(balance.availableBalance);
        if (availableBefore.lt(amount)) {
          throw new ConflictException(
            `INSUFFICIENT_BALANCE: required ${amount.toFixed(18)} but available ${availableBefore.toFixed(18)}`,
          );
        }

        const availableAfter = availableBefore.minus(amount);
        const lockedAfter = this.parseAmount(balance.lockedBalance).plus(
          amount,
        );
        const tradingLockedAfter = this.parseAmount(balance.tradingLocked).plus(
          amount,
        );

        balance.availableBalance = availableAfter.toFixed(18);
        balance.lockedBalance = lockedAfter.toFixed(18);
        balance.tradingLocked = tradingLockedAfter.toFixed(18);
        balance.lastUpdatedAt = new Date();
        await txBalanceRepo.save(balance);

        const trade = txTradeRepo.create({
          userId,
          pair: symbol,
          direction: dto.direction,
          duration: durationSeconds,
          amount: amount.toFixed(18),
          entryPrice: priceIndex.indexPrice,
          status: TradeStatus.ACCEPTED,
          createdAt: now,
          expiryAt: expiresAt,
          clientRequestId,
        });

        const savedTrade = await txTradeRepo.save(trade);

        const ledgerEntry = txLedgerRepo.create({
          userId,
          type: LedgerType.TRADE_ENTRY,
          amount: amount.toFixed(18),
          balanceBefore: availableBefore.toFixed(18),
          balanceAfter: availableAfter.toFixed(18),
          referenceId: savedTrade.id,
          referenceType: 'pulse_trade',
          description: `Pulse trade entry ${symbol} ${dto.direction} ${durationCode}`,
          metadata: {
            symbol,
            direction: dto.direction,
            duration: durationCode,
            fee: fee.toFixed(18),
            netStake: netStake.toFixed(18),
            clientRequestId,
          },
        });

        await txLedgerRepo.save(ledgerEntry);

        const feeLedgerEntry = txLedgerRepo.create({
          userId,
          type: LedgerType.TRADE_FEE,
          amount: fee.toFixed(18),
          balanceBefore: availableAfter.toFixed(18),
          balanceAfter: availableAfter.toFixed(18),
          referenceId: savedTrade.id,
          referenceType: PULSE_SETTLEMENT_POLICY.ledger.feeReferenceType,
          description: `Pulse trade fee allocation ${symbol} ${dto.direction} ${durationCode}`,
          metadata: {
            tradeId: savedTrade.id,
            symbol,
            direction: dto.direction,
            duration: durationCode,
            totalFee: fee.toFixed(18),
            referral: feeBreakdown.referral.toFixed(18),
            admin: feeBreakdown.admin.toFixed(18),
            bonusVault: feeBreakdown.bonusVault.toFixed(18),
            allocationReferenceType:
              PULSE_SETTLEMENT_POLICY.ledger.feeAllocationReferenceType,
            referralDistributionTiming:
              PULSE_SETTLEMENT_POLICY.referral.distributionTiming,
            referralUnassignedPolicy:
              PULSE_SETTLEMENT_POLICY.referral.unassignedPolicy,
            unassignedAccountingDestination:
              PULSE_SETTLEMENT_POLICY.referral.unassignedAccountingDestination,
            referralLevels: PULSE_SETTLEMENT_POLICY.referral.levels,
            adminDestination:
              PULSE_SETTLEMENT_POLICY.admin.accountingDestination,
            bonusVaultDestination:
              PULSE_SETTLEMENT_POLICY.bonusVault.accountingDestination,
            policyVersion: PULSE_SETTLEMENT_POLICY.payout.version,
            policyStatus: {
              fee: PULSE_SETTLEMENT_POLICY.fee.status,
              referral: PULSE_SETTLEMENT_POLICY.referral.status,
              admin: PULSE_SETTLEMENT_POLICY.admin.status,
              bonusVault: PULSE_SETTLEMENT_POLICY.bonusVault.status,
            },
            clientRequestId,
          },
        });

        await txLedgerRepo.save(feeLedgerEntry);

        const referralDistributionTargets =
          await this.resolveReferralDistributionTargets(manager, userId);

        /*
         * Referral accounting is part of the SAME placement transaction:
         *
         * 1. Existing upline:
         *    - lock the upline Balance row
         *    - credit availableBalance + totalBalance
         *    - write the referral ledger against the upline
         *
         * 2. Missing upline:
         *    - never credit the trader/random user
         *    - route the amount to the authoritative Pulse liquidity setting
         *    - keep a separate audit/ledger reference type
         *
         * The referral percentages are percentages of the GROSS STAKE.
         * L1..L6 = 0.75% + 0.35% + 0.25% + 0.25% + 0.20% + 0.20% = 2.00%.
         */
        let totalReferralPaidToUplines = new Decimal(0);
        let totalReferralRoutedToLiquidity = new Decimal(0);

        for (const distributionTarget of referralDistributionTargets) {
          const levelLabel =
            `L${distributionTarget.level}` as keyof typeof PULSE_SETTLEMENT_POLICY.referral.levels;
          const levelPercent =
            PULSE_SETTLEMENT_POLICY.referral.levels[levelLabel] ?? '0';
          const levelAmount = this.percentOf(amount, levelPercent);

          if (levelAmount.lte(0)) {
            continue;
          }

          const recipientUserId = distributionTarget.ancestorUserId;
          const hasUpline = Boolean(recipientUserId);
          const destination = hasUpline
            ? 'UPLINE_USER'
            : PULSE_SETTLEMENT_POLICY.referral.unassignedAccountingDestination;
          const referenceType = hasUpline
            ? PULSE_SETTLEMENT_POLICY.ledger.feeAllocationReferenceType
            : PULSE_SETTLEMENT_POLICY.ledger
                .unallocatedReferralToLiquidityReferenceType;

          const distributionReferenceId = `${savedTrade.id}:L${distributionTarget.level}:${
            hasUpline
              ? recipientUserId
              : PULSE_SETTLEMENT_POLICY.referral.unassignedAccountingDestination
          }`;

          let recipientBalanceBefore = new Decimal(0);
          let recipientBalanceAfter = new Decimal(0);

          if (hasUpline && recipientUserId) {
            const recipientBalance = await this.getOrCreateBalanceForUpdate(
              txBalanceRepo,
              recipientUserId,
            );

            recipientBalanceBefore = this.parseAmount(
              recipientBalance.availableBalance,
            );
            recipientBalanceAfter = recipientBalanceBefore.plus(levelAmount);

            recipientBalance.availableBalance =
              recipientBalanceAfter.toFixed(18);
            recipientBalance.totalBalance = this.parseAmount(
              recipientBalance.totalBalance,
            )
              .plus(levelAmount)
              .toFixed(18);
            recipientBalance.lastUpdatedAt = new Date();

            await txBalanceRepo.save(recipientBalance);

            totalReferralPaidToUplines =
              totalReferralPaidToUplines.plus(levelAmount);
          } else {
            /*
             * The AdminSetting row is already pessimistically locked when
             * placement liquidity enforcement is available. In production
             * this is the authoritative Pulse liquidity pool.
             */
            if (!liquidityPoolSettingForReferral) {
              throw new ConflictException(
                'PULSE_LIQUIDITY_POOL_UNAVAILABLE_FOR_REFERRAL_ALLOCATION',
              );
            }

            // HIGH-4 (unallocated referral → liquidity idempotency):
            // fast-path guard. Same (referenceType, referenceId) leg pehle se
            // committed hai to yahin fail-closed conflict — pool credit aur
            // ledger write ek hi atomic pair hain (dono hote hain ya dono
            // nahi). DB unique index (migration 1768) final concurrency
            // backstop hai.
            const existingUnallocatedLeg = await txLedgerRepo.findOne({
              where: {
                referenceType:
                  PULSE_SETTLEMENT_POLICY.ledger
                    .unallocatedReferralToLiquidityReferenceType,
                referenceId: distributionReferenceId,
              },
            });
            if (existingUnallocatedLeg) {
              throw new ConflictException(
                'REFERRAL_UNALLOCATED_LEDGER_CONFLICT: unallocated referral liquidity leg already exists for this trade',
              );
            }

            const poolBefore = Decimal.max(
              this.parseAmount(liquidityPoolSettingForReferral.value),
              0,
            );
            const poolAfter = poolBefore.plus(levelAmount);

            liquidityPoolSettingForReferral.value = poolAfter.toFixed(18);
            liquidityPoolSettingForReferral.updatedBy = null;
            totalReferralRoutedToLiquidity =
              totalReferralRoutedToLiquidity.plus(levelAmount);
          }

          /*
           * LedgerEntry.userId is non-null in the current schema. Therefore
           * pool-routed entries retain source-user attribution at the DB row
           * level, but MUST be identified by the dedicated referenceType and
           * must be excluded by user-wallet/referral aggregations.
           *
           * For actual uplines, userId is the credited upline.
           */
          const ledgerUserId = hasUpline ? (recipientUserId as string) : userId;

          const distributionEntry = txLedgerRepo.create({
            userId: ledgerUserId,
            type: LedgerType.TRADE_FEE,
            amount: levelAmount.toFixed(18),
            balanceBefore: hasUpline
              ? recipientBalanceBefore.toFixed(18)
              : availableAfter.toFixed(18),
            balanceAfter: hasUpline
              ? recipientBalanceAfter.toFixed(18)
              : availableAfter.toFixed(18),
            referenceId: distributionReferenceId,
            referenceType,
            description: hasUpline
              ? `Pulse trade referral reward L${distributionTarget.level} for trade ${savedTrade.id}`
              : `Pulse trade referral allocation L${distributionTarget.level} routed to Pulse liquidity for trade ${savedTrade.id}`,
            metadata: {
              tradeId: savedTrade.id,
              sourceUserId: userId,
              recipientUserId: recipientUserId ?? null,
              referralLevel: distributionTarget.level,
              referralLevelPercent: levelPercent,
              amount: levelAmount.toFixed(18),
              distributionReferenceId,
              distributionReferenceType: referenceType,
              distributionTiming:
                PULSE_SETTLEMENT_POLICY.referral.distributionTiming,
              unassignedPolicy:
                PULSE_SETTLEMENT_POLICY.referral.unassignedPolicy,
              destination,
              unassignedAccountingDestination:
                PULSE_SETTLEMENT_POLICY.referral
                  .unassignedAccountingDestination,
              hasUpline,
              accounting: hasUpline
                ? 'UPLINE_BALANCE_CREDIT'
                : 'LIQUIDITY_POOL_CREDIT',
              policyVersion: PULSE_SETTLEMENT_POLICY.payout.version,
              clientRequestId,
            },
          });

          try {
            await txLedgerRepo.save(distributionEntry);
          } catch (error) {
            if (this.isUnallocatedReferralUniqueViolation(error)) {
              // HIGH-4 backstop: pre-check race loss par 23505 aata hai.
              // PostgreSQL transaction ab aborted hai — continue karna unsafe
              // hai, isliye typed conflict throw → poora placement tx roll
              // back (koi partial financial state nahi). Baaki 23505
              // (clientRequestId, TRADE_FEE_DISTRIBUTION, etc.) aise hi
              // rethrow hote hain — kuch swallow nahi hota.
              throw new ConflictException(
                'REFERRAL_UNALLOCATED_LEDGER_CONFLICT: unallocated referral liquidity leg already exists for this trade',
              );
            }
            throw error;
          }
        }

        /*
         * Persist the pool once after all missing levels have been calculated.
         * The row was pessimistically locked at the beginning of this
         * transaction, so concurrent placements cannot overwrite each other.
         */
        if (totalReferralRoutedToLiquidity.gt(0)) {
          if (!liquidityPoolSettingForReferral) {
            throw new ConflictException(
              'PULSE_LIQUIDITY_POOL_UNAVAILABLE_FOR_REFERRAL_ALLOCATION',
            );
          }

          await manager
            .getRepository(AdminSetting)
            .save(liquidityPoolSettingForReferral);
        }

        /*
         * The invariant is always:
         * referral allocation = paid upline + routed to liquidity.
         */
        const referralAllocation = feeBreakdown.referral;
        const accountedReferral = totalReferralPaidToUplines.plus(
          totalReferralRoutedToLiquidity,
        );

        if (!accountedReferral.eq(referralAllocation)) {
          throw new ConflictException(
            `REFERRAL_ALLOCATION_RECONCILIATION_FAILED: expected ${referralAllocation.toFixed(18)} but accounted ${accountedReferral.toFixed(18)}`,
          );
        }

        return { trade: savedTrade };
      });
    } catch (error) {
      if (this.isClientRequestUniqueViolation(error)) {
        const replay = await this.tradeRepo.findOne({
          where: { userId, clientRequestId },
          order: { createdAt: 'DESC' },
        });

        if (replay) {
          // HIGH-5: unique-violation replay bhi financially verified hona
          // chahiye — incomplete/inconsistent state par fail-closed.
          const completeness = await this.verifyPlacementFinancialCompleteness(
            replay,
            userId,
            this.dataSource.getRepository(LedgerEntry),
            this.dataSource.getRepository(AdminSetting),
            this.balanceRepo,
          );
          if (completeness !== 'COMPLETE') {
            throw new ConflictException(
              completeness === 'INCOMPLETE'
                ? 'PLACEMENT_REPLAY_INCOMPLETE: placement financial state is incomplete'
                : 'PLACEMENT_REPLAY_INCONSISTENT: placement financial state is inconsistent',
            );
          }
          return this.toPlaceTradeResult(
            replay,
            await this.getUserBalanceSnapshot(userId),
          );
        }
      }

      throw error;
    }

    if ('replay' in placementOutcome) {
      return this.toPlaceTradeResult(
        placementOutcome.replay,
        await this.getUserBalanceSnapshot(userId),
      );
    }

    return this.toPlaceTradeResult(
      placementOutcome.trade,
      await this.getUserBalanceSnapshot(userId),
    );
  }

  async getOpenTrades(userId: string) {
    const trades = await this.tradeRepo.find({
      where: ACTIVE_SETTLEMENT_STATUSES.map((status) => ({ userId, status })),
      order: { createdAt: 'DESC' },
    });

    return {
      trades: trades.map((trade) => this.toOpenTradeView(trade)),
    };
  }

  async getTradeById(userId: string, tradeId: string) {
    const trade = await this.tradeRepo.findOne({
      where: { id: tradeId, userId },
    });
    if (!trade) {
      throw new NotFoundException('TRADE_NOT_FOUND');
    }

    const durationCode = this.durationCodeFromTrade(trade.duration);
    const amount = this.parseAmount(trade.amount);
    const feeBreakdown = this.computeTradeFeeBreakdown(amount);

    return {
      trade: {
        id: trade.id,
        symbol: trade.pair,
        direction: trade.direction,
        duration: durationCode,
        stake: amount.toFixed(18),
        fee: feeBreakdown.totalFee.toFixed(18),
        netStake: feeBreakdown.netStake.toFixed(18),
        entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
        expiryPrice: trade.exitPrice
          ? this.parseAmount(trade.exitPrice).toFixed(18)
          : null,
        entryAt: trade.createdAt.toISOString(),
        expiresAt: trade.expiryAt.toISOString(),
        settledAt: trade.settledAt ? trade.settledAt.toISOString() : null,
        status: this.publicStatus(trade),
        result: trade.result ?? null,
        payout: this.payoutForTrade(trade),
        remainingSeconds: this.remainingSeconds(new Date(), trade.expiryAt),
      },
    };
  }

  async getTradeHistory(userId: string, query: TradeHistoryQueryDto) {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const qb = this.tradeRepo
      .createQueryBuilder('trade')
      .where('trade.userId = :userId', { userId })
      .orderBy('trade.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.symbol) {
      qb.andWhere('trade.pair = :pair', {
        pair: this.normalizeSymbolOrThrow(query.symbol),
      });
    }

    if (query.status) {
      qb.andWhere('trade.status = :status', { status: query.status });
    }

    if (query.direction) {
      qb.andWhere('trade.direction = :direction', {
        direction: query.direction,
      });
    }

    if (query.duration) {
      const durationCode = this.normalizeDurationOrThrow(query.duration);
      qb.andWhere('trade.duration = :durationSeconds', {
        durationSeconds: pulseDurationCodeToSeconds(durationCode),
      });
    }

    this.applyDateFilters(qb, query.from, query.to);

    const [rows, total] = await qb.getManyAndCount();

    return {
      total,
      limit,
      offset,
      trades: rows.map((trade) => this.toHistoryTradeView(trade)),
    };
  }

  async getPortfolio(userId: string) {
    const balance = await this.balanceRepo.findOne({ where: { userId } });

    const statsRaw = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('COUNT(*)', 'totalTrades')
      .addSelect(
        `SUM(CASE WHEN trade.result = :winResult THEN 1 ELSE 0 END)`,
        'wins',
      )
      .addSelect(
        `SUM(CASE WHEN trade.result = :lossResult THEN 1 ELSE 0 END)`,
        'losses',
      )
      .addSelect(
        `SUM(CASE WHEN trade.result = :drawResult THEN 1 ELSE 0 END)`,
        'draws',
      )
      .addSelect('COALESCE(SUM(trade.amount), 0)', 'totalStake')
      .addSelect(
        `COALESCE(SUM(CASE WHEN trade.status = :settledStatus AND trade.result = :winResult THEN trade.amount ELSE 0 END), 0)`,
        'settledWinStake',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN trade.status = :settledStatus AND trade.result = :lossResult THEN trade.amount ELSE 0 END), 0)`,
        'settledLossStake',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN trade.status = :settledStatus AND trade.result = :drawResult THEN trade.amount ELSE 0 END), 0)`,
        'settledDrawStake',
      )
      .setParameters({
        winResult: TradeResult.WIN,
        lossResult: TradeResult.LOSS,
        drawResult: TradeResult.DRAW,
        settledStatus: TradeStatus.SETTLED,
      })
      .where('trade.userId = :userId', { userId })
      .getRawOne<{
        totalTrades: string;
        wins: string;
        losses: string;
        draws: string;
        totalStake: string;
        settledWinStake?: string;
        settledLossStake?: string;
        settledDrawStake?: string;
      }>();

    const openExposureRaw = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.amount), 0)', 'openExposure')
      .where('trade.userId = :userId', { userId })
      .andWhere('trade.status IN (:...openStatuses)', {
        openStatuses: ACTIVE_SETTLEMENT_STATUSES,
      })
      .getRawOne<{ openExposure: string }>();

    const totalTrades = Number(statsRaw?.totalTrades ?? '0');
    const wins = Number(statsRaw?.wins ?? '0');
    const losses = Number(statsRaw?.losses ?? '0');
    const draws = Number(statsRaw?.draws ?? '0');

    const winRate =
      totalTrades === 0
        ? new Decimal(0)
        : new Decimal(wins).mul(100).div(totalTrades);
    const totalFees = this.percentOf(
      this.parseAmount(statsRaw?.totalStake ?? '0'),
      PULSE_SETTLEMENT_POLICY.fee.totalPercent,
    );
    const settledWinStake = this.parseAmount(statsRaw?.settledWinStake ?? '0');
    const settledLossStake = this.parseAmount(
      statsRaw?.settledLossStake ?? '0',
    );
    const settledDrawStake = this.parseAmount(
      statsRaw?.settledDrawStake ?? '0',
    );
    const settledStake = settledWinStake
      .plus(settledLossStake)
      .plus(settledDrawStake);
    const totalPayout = this.computePayout(settledWinStake, TradeResult.WIN)
      .plus(this.computePayout(settledDrawStake, TradeResult.DRAW))
      .plus(this.computePayout(settledLossStake, TradeResult.LOSS));
    // Portfolio totalProfit is net player PnL from settled economics only.
    // Equivalent identity:
    //   totalProfit = settledStake - totalPayout
    // Fees are already embedded in payout via settlement policy (especially WIN payout),
    // so totalFees is reported as a separate informational metric and is NOT subtracted again.
    const totalProfit = settledStake.minus(totalPayout);

    return {
      availableBalance: this.parseAmount(
        balance?.availableBalance ?? '0',
      ).toFixed(18),
      openExposure: this.parseAmount(
        openExposureRaw?.openExposure ?? '0',
      ).toFixed(18),
      totalTrades,
      wins,
      losses,
      draws,
      winRate: winRate.toFixed(2),
      totalProfit: totalProfit.toFixed(18),
      totalFees: totalFees.toFixed(18),
    };
  }

  async getLiquidity() {
    const openExposureRaw = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('COALESCE(SUM(trade.amount), 0)', 'openExposure')
      .where('trade.status IN (:...openStatuses)', {
        openStatuses: ACTIVE_SETTLEMENT_STATUSES,
      })
      .getRawOne<{ openExposure: string }>();

    const poolBalance = await this.getLiquidityPoolBalance();
    const reservedAmount = this.parseAmount(
      openExposureRaw?.openExposure ?? '0',
    );
    const availableLiquidity = Decimal.max(
      poolBalance.minus(reservedAmount),
      0,
    );

    const utilizationPercent = poolBalance.lte(0)
      ? new Decimal(0)
      : reservedAmount.mul(100).div(poolBalance);

    const riskState = utilizationPercent.gte(90)
      ? 'CRITICAL'
      : utilizationPercent.gte(80)
        ? 'HIGH'
        : utilizationPercent.gte(70)
          ? 'WARNING'
          : 'NORMAL';

    return {
      poolBalance: poolBalance.toFixed(18),
      reservedAmount: reservedAmount.toFixed(18),
      availableLiquidity: availableLiquidity.toFixed(18),
      openExposure: reservedAmount.toFixed(18),
      riskState,
    };
  }

  async getRisk() {
    return {
      state: 'NORMAL',
      maxAllowedTrade: PULSE_MAX_TRADE_AMOUNT_TDX,
      acceptingTrades: true,
      reason: null,
    };
  }

  async adjustAdminLiquidity(
    adminId: string,
    dto: AdminAdjustLiquidityDto,
    context: AdminLiquidityAdjustContext,
  ) {
    const actionRaw = String(dto.action ?? '')
      .trim()
      .toUpperCase();
    if (actionRaw !== 'ADD' && actionRaw !== 'REMOVE') {
      throw new BadRequestException('action must be one of ADD or REMOVE');
    }

    const action: 'ADD' | 'REMOVE' = actionRaw;
    const amount = this.parsePositiveAmount(dto.amount, 'amount');
    const reason = String(dto.reason ?? '').trim();

    const referenceValue = String(dto.reference ?? '').trim();
    const noteValue = String(dto.note ?? '').trim();

    if (reason.length > 120) {
      throw new BadRequestException('reason must not exceed 120 characters');
    }

    if (referenceValue.length > 120) {
      throw new BadRequestException('reference must not exceed 120 characters');
    }

    if (noteValue.length > 500) {
      throw new BadRequestException('note must not exceed 500 characters');
    }

    const reference = referenceValue || null;
    const note = noteValue || null;

    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    return this.dataSource.transaction(async (manager) => {
      const setting =
        await this.getOrCreateLiquidityPoolSettingForUpdate(manager);
      const auditRepo = manager.getRepository(AdminAuditLog);

      if (reference && this.canQueryLiquidityActivityByReference(auditRepo)) {
        const existingActivity =
          await this.findLatestLiquidityActivityByReference(
            auditRepo,
            reference,
          );

        if (existingActivity) {
          if (
            this.isMatchingLiquidityAdjustmentReference(existingActivity, {
              action,
              amount,
              reason,
              reference,
              note,
            })
          ) {
            return this.mapLiquidityActivity(existingActivity);
          }

          throw new ConflictException(
            'DUPLICATE_REFERENCE_CONFLICT: reference already exists for a different liquidity adjustment payload',
          );
        }
      }

      const balanceBefore = Decimal.max(this.parseAmount(setting.value), 0);
      const reservedLiquidity = await this.getReservedLiquidity(manager);
      const availableLiquidityBefore = Decimal.max(
        balanceBefore.minus(reservedLiquidity),
        0,
      );

      let balanceAfter: Decimal;

      if (action === 'ADD') {
        balanceAfter = balanceBefore.plus(amount);
      } else {
        if (amount.gt(availableLiquidityBefore)) {
          await auditRepo.save(
            auditRepo.create({
              adminId,
              action: PULSE_LIQUIDITY_AUDIT_ACTION,
              targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
              targetId: setting.id,
              oldValue: {
                poolBalance: balanceBefore.toFixed(18),
              },
              newValue: {
                poolBalance: balanceBefore.toFixed(18),
              },
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
              metadata: {
                action,
                amount: amount.toFixed(18),
                balanceBefore: balanceBefore.toFixed(18),
                balanceAfter: balanceBefore.toFixed(18),
                reservedLiquidity: reservedLiquidity.toFixed(18),
                availableLiquidity: availableLiquidityBefore.toFixed(18),
                result: 'FAILED',
                reason,
                reference,
                note,
                failureReason:
                  'INSUFFICIENT_AVAILABLE_LIQUIDITY: remove amount exceeds available liquidity',
              },
            }),
          );

          throw new ConflictException(
            'INSUFFICIENT_AVAILABLE_LIQUIDITY: remove amount exceeds available liquidity',
          );
        }

        balanceAfter = balanceBefore.minus(amount);
      }

      setting.value = balanceAfter.toFixed(18);
      setting.updatedBy = adminId;
      await manager.getRepository(AdminSetting).save(setting);

      const availableLiquidityAfter = Decimal.max(
        balanceAfter.minus(reservedLiquidity),
        0,
      );

      const activity = await auditRepo.save(
        auditRepo.create({
          adminId,
          action: PULSE_LIQUIDITY_AUDIT_ACTION,
          targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
          targetId: setting.id,
          oldValue: {
            poolBalance: balanceBefore.toFixed(18),
          },
          newValue: {
            poolBalance: balanceAfter.toFixed(18),
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            action,
            amount: amount.toFixed(18),
            balanceBefore: balanceBefore.toFixed(18),
            balanceAfter: balanceAfter.toFixed(18),
            reservedLiquidity: reservedLiquidity.toFixed(18),
            availableLiquidity: availableLiquidityAfter.toFixed(18),
            result: 'SUCCESS',
            reason,
            reference,
            note,
          },
        }),
      );

      return this.mapLiquidityActivity(activity);
    });
  }

  async getAdminLiquidityActivity(
    query: AdminLiquidityActivityQueryDto,
  ): Promise<AdminLiquidityActivityResponse> {
    const limit =
      typeof query.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(100, query.limit))
        : 20;
    const offset =
      typeof query.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, query.offset)
        : 0;

    const qb = this.dataSource
      .getRepository(AdminAuditLog)
      .createQueryBuilder('auditLog')
      .where('auditLog.action = :action', {
        action: PULSE_LIQUIDITY_AUDIT_ACTION,
      })
      .andWhere('auditLog.targetType = :targetType', {
        targetType: PULSE_LIQUIDITY_AUDIT_TARGET_TYPE,
      });

    if (query.action && query.action !== 'ALL') {
      qb.andWhere(`auditLog.metadata ->> 'action' = :activityAction`, {
        activityAction: query.action,
      });
    }

    if (query.result && query.result !== 'ALL') {
      qb.andWhere(`auditLog.metadata ->> 'result' = :result`, {
        result: query.result,
      });
    }

    const adminId = query.adminId?.trim();
    if (adminId) {
      qb.andWhere('auditLog.adminId = :adminId', { adminId });
    }

    const from = query.from?.trim();
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        qb.andWhere('auditLog.createdAt >= :fromDate', {
          fromDate: fromDate.toISOString(),
        });
      }
    }

    const to = query.to?.trim();
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        qb.andWhere('auditLog.createdAt <= :toDate', {
          toDate: toDate.toISOString(),
        });
      }
    }

    const [rows, total] = await qb
      .orderBy('auditLog.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      items: rows.map((row) => this.mapLiquidityActivity(row)),
      total,
      limit,
      offset,
    };
  }

  async settleTrade(tradeId: string): Promise<SettlementResult> {
    const now = new Date();

    const preloadedTrade = await this.tradeRepo.findOne({
      where: { id: tradeId },
    });
    if (!preloadedTrade) {
      throw new NotFoundException('TRADE_NOT_FOUND');
    }

    // CRITICAL-2 guard (fast path): pehle se SETTLED hai to idempotent
    // success — dobara payout/ledger/status-touch bilkul nahi.
    if (preloadedTrade.status === TradeStatus.SETTLED) {
      return this.toSettlementResult(preloadedTrade);
    }

    if (this.isTerminalNonSettlableStatus(preloadedTrade.status)) {
      throw new ConflictException('TRADE_TERMINAL_STATUS');
    }

    if (preloadedTrade.expiryAt.getTime() > now.getTime()) {
      throw new ConflictException('TRADE_NOT_EXPIRED');
    }

    let settlementPrice: string;
    try {
      const priceIndex = await this.priceService.getAuthoritativePriceIndex(
        preloadedTrade.pair,
      );
      settlementPrice = this.parseAmount(priceIndex.indexPrice).toFixed(18);
    } catch (error) {
      const retryReason = this.toErrorMessage(error);
      const settlementRetryCount =
        Math.max(Number(preloadedTrade.settlementRetryCount ?? 0), 0) + 1;
      const lastSettlementAttemptAt = new Date();
      const nextSettlementRetryAt = new Date(
        lastSettlementAttemptAt.getTime() +
          this.getSettlementRetryDelaySeconds() * 1000,
      );

      await this.tradeRepo.update(
        {
          id: tradeId,
          status: In(ACTIVE_SETTLEMENT_STATUSES),
        },
        {
          status: TradeStatus.SETTLEMENT_DELAYED,
          settlementRetryCount,
          settlementFailureReason: retryReason,
          lastSettlementAttemptAt,
          nextSettlementRetryAt,
        },
      );

      throw error;
    }

    try {
      const settledTrade = await this.dataSource.transaction(
        async (manager) => {
          const txTradeRepo = manager.getRepository(Trade);
          const txBalanceRepo = manager.getRepository(Balance);
          const txLedgerRepo = manager.getRepository(LedgerEntry);
          const txAdminSettingRepo = manager.getRepository(AdminSetting);

          const trade = await txTradeRepo.findOne({
            where: { id: tradeId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!trade) {
            throw new NotFoundException('TRADE_NOT_FOUND');
          }

          if (trade.status === TradeStatus.SETTLED) {
            return trade;
          }

          if (this.isTerminalNonSettlableStatus(trade.status)) {
            throw new ConflictException('TRADE_TERMINAL_STATUS');
          }

          if (trade.expiryAt.getTime() > now.getTime()) {
            throw new ConflictException('TRADE_NOT_EXPIRED');
          }

          const previousTerminalStatus = trade.status;
          trade.status = TradeStatus.SETTLING;
          await txTradeRepo.save(trade);

          let balance = await txBalanceRepo.findOne({
            where: { userId: trade.userId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!balance) {
            const zero = '0.000000000000000000';
            balance = txBalanceRepo.create({
              userId: trade.userId,
              availableBalance: zero,
              lockedBalance: zero,
              gameLocked: zero,
              tradingLocked: zero,
              withdrawalLocked: zero,
              totalBalance: zero,
            });
            balance = await txBalanceRepo.save(balance);
          }

          const stake = this.parseAmount(trade.amount);
          const currentlyLocked = this.parseAmount(balance.lockedBalance);
          const currentlyTradingLocked = this.parseAmount(
            balance.tradingLocked,
          );

          if (currentlyLocked.lt(stake) || currentlyTradingLocked.lt(stake)) {
            throw new ConflictException(
              'BALANCE_LOCK_MISMATCH_FOR_SETTLEMENT',
            );
          }

          const entryPrice = this.parseAmount(trade.entryPrice);
          const expiryPrice = this.parseAmount(settlementPrice);
          const result = this.determineTradeResult(
            trade.direction,
            entryPrice,
            expiryPrice,
          );
          const payout = this.computePayout(stake, result);

          const liquidityPoolSetting =
            await this.getOrCreateLiquidityPoolSettingForUpdate(manager);
          const liquidityPoolBalanceBefore = Decimal.max(
            this.parseAmount(liquidityPoolSetting.value),
            0,
          );
          // Settlement liquidity accounting invariant:
          //   platformPnl = stake - payout
          //   poolAfter = poolBefore + platformPnl
          // WIN  => platformPnl < 0 (pool pays out)
          // LOSS => platformPnl > 0 (pool retains stake)
          // DRAW => platformPnl = 0 (pool unchanged)
          const liquidityPoolDelta = stake.minus(payout);
          const liquidityPoolBalanceAfter =
            liquidityPoolBalanceBefore.plus(liquidityPoolDelta);

          if (liquidityPoolBalanceAfter.lt(0)) {
            throw new ConflictException(
              'LIQUIDITY_POOL_BALANCE_UNDERFLOW_FOR_SETTLEMENT',
            );
          }

          liquidityPoolSetting.value = liquidityPoolBalanceAfter.toFixed(18);
          liquidityPoolSetting.updatedBy = null;
          await txAdminSettingRepo.save(liquidityPoolSetting);

      const availableBefore = this.parseAmount(balance.availableBalance);
      const lockedAfter = currentlyLocked.minus(stake);
      const tradingLockedAfter = currentlyTradingLocked.minus(stake);
      const availableAfter = availableBefore.plus(payout);
      const totalBefore = this.parseAmount(balance.totalBalance);
      const totalAfter = totalBefore.minus(stake).plus(payout);

      balance.availableBalance = availableAfter.toFixed(18);
      balance.lockedBalance = lockedAfter.toFixed(18);
      balance.tradingLocked = tradingLockedAfter.toFixed(18);
      balance.totalBalance = totalAfter.toFixed(18);
      balance.lastUpdatedAt = now;
      await txBalanceRepo.save(balance);

      const ledgerType =
        result === TradeResult.DRAW
          ? LedgerType.TRADE_DRAW
          : result === TradeResult.WIN
            ? LedgerType.TRADE_PROFIT
            : LedgerType.TRADE_LOSS;
      const pnl = payout.minus(stake);
      const ledgerAmount = pnl.abs();

      const settlementFeeBreakdown = this.computeTradeFeeBreakdown(stake);

      const ledgerEntry = txLedgerRepo.create({
        userId: trade.userId,
        type: ledgerType,
        amount: ledgerAmount.toFixed(18),
        balanceBefore: availableBefore.toFixed(18),
        balanceAfter: availableAfter.toFixed(18),
        referenceId: trade.id,
        referenceType: PULSE_SETTLEMENT_POLICY.ledger.settlementReferenceType,
        description: `Pulse trade settlement ${trade.pair} ${trade.direction} (${result})`,
        metadata: {
          tradeId: trade.id,
          pair: trade.pair,
          direction: trade.direction,
          stake: stake.toFixed(18),
          fee: settlementFeeBreakdown.totalFee.toFixed(18),
          netStake: settlementFeeBreakdown.netStake.toFixed(18),
          feeBreakdown: {
            referral: settlementFeeBreakdown.referral.toFixed(18),
            admin: settlementFeeBreakdown.admin.toFixed(18),
            bonusVault: settlementFeeBreakdown.bonusVault.toFixed(18),
          },
          entryPrice: entryPrice.toFixed(18),
          expiryPrice: expiryPrice.toFixed(18),
          result,
          payout: payout.toFixed(18),
          pnl: pnl.toFixed(18),
          platformPnl: liquidityPoolDelta.toFixed(18),
          settlementVersion: PULSE_SETTLEMENT_POLICY.payout.version,
          payoutPolicyStatus: PULSE_SETTLEMENT_POLICY.payout.status,
          settlementReferenceTypeStatus:
            PULSE_SETTLEMENT_POLICY.ledger.settlementReferenceTypeStatus,
          liquidityPool: {
            balanceBefore: liquidityPoolBalanceBefore.toFixed(18),
            balanceAfter: liquidityPoolBalanceAfter.toFixed(18),
            delta: liquidityPoolDelta.toFixed(18),
          },
          previousStatus: previousTerminalStatus,
        },
      });

      await txLedgerRepo.save(ledgerEntry);

      trade.exitPrice = expiryPrice.toFixed(18);
      trade.result = result;
      trade.status = TradeStatus.SETTLED;
      trade.settledAt = now;
      trade.lastSettlementAttemptAt = now;
      trade.settlementFailureReason = null;
      trade.nextSettlementRetryAt = null;
      return txTradeRepo.save(trade);
        },
      );

      return this.toSettlementResult(settledTrade);
    } catch (error) {
      // CRITICAL-2 race guard: commit-phase ka koi bhi exception (duplicate /
      // unique ledger conflict, balance race, DB error) blindly DELAYED me
      // mat badlo. Pehle authoritative DB state dobara padho:
      // - SETTLED mil gaya → doosre worker ne jeet liya; idempotent success
      //   return karo. No payout, no ledger, no status-touch.
      // - abhi bhi ACTIVE hai → tabhi DELAYED/retry lagao.
      // - terminal (non-SETTLED) hai → waisa hi rehne do, original error pheko.
      return this.handleSettlementCommitFailure(tradeId, error);
    }
  }

  /**
   * CRITICAL-2: settlement commit-phase failure ka race-safe handler.
   * Sirf tabhi SETTLEMENT_DELAYED lagata hai jab trade abhi bhi active
   * settlement state me hai. SETTLED milne par idempotent success return
   * hota hai (proof: DB row + existing settlement ledger jab mile).
   */
  private async handleSettlementCommitFailure(
    tradeId: string,
    error: unknown,
  ): Promise<SettlementResult> {
    const current = await this.tradeRepo.findOne({
      where: { id: tradeId },
    });

    if (!current) {
      throw error instanceof Error
        ? error
        : new Error('PULSE_TRADE_SETTLEMENT_FAILED');
    }

    if (current.status === TradeStatus.SETTLED) {
      this.logger.log(
        `settleTrade race resolved for trade ${tradeId}: already SETTLED by a concurrent worker (idempotent success, no duplicate payout)`,
      );
      return this.toSettlementResult(current);
    }

    if (this.isTerminalNonSettlableStatus(current.status)) {
      this.logger.warn(
        `settleTrade skipped DELAYED transition for trade ${tradeId}: terminal status ${current.status} preserved`,
      );
      throw error instanceof Error
        ? error
        : new Error('PULSE_TRADE_SETTLEMENT_FAILED');
    }

    if (
      (ACTIVE_SETTLEMENT_STATUSES as string[]).includes(current.status) &&
      this.isSettlementIdempotencyConflict(error)
    ) {
      // Duplicate/idempotency conflict + row abhi bhi ACTIVE: ho sakta hai
      // winner ka commit itna fresh ho ki re-read me dikha nahi, ya ledger
      // guard ne duplicate roka ho. Settlement ledger maujood hai to use
      // successful settlement ka proof mano.
      const proof = await this.findExistingSettlementProof(tradeId);
      if (proof.settled) {
        const settledRow =
          (await this.tradeRepo.findOne({ where: { id: tradeId } })) ??
          current;
        if (settledRow.status === TradeStatus.SETTLED) {
          this.logger.log(
            `settleTrade race resolved for trade ${tradeId}: settlement ledger already exists (idempotent success, no duplicate payout)`,
          );
          return this.toSettlementResult(settledRow);
        }
        this.logger.warn(
          `settleTrade found existing settlement ledger for trade ${tradeId} but status is ${settledRow.status}; keeping authoritative status, no duplicate payout`,
        );
        throw error instanceof Error
          ? error
          : new Error('PULSE_TRADE_SETTLEMENT_FAILED');
      }
    }

    if ((ACTIVE_SETTLEMENT_STATUSES as string[]).includes(current.status)) {
      const settlementRetryCount =
        Math.max(Number(current.settlementRetryCount ?? 0), 0) + 1;
      const lastSettlementAttemptAt = new Date();
      const nextSettlementRetryAt = new Date(
        lastSettlementAttemptAt.getTime() +
          this.getSettlementRetryDelaySeconds() * 1000,
      );

      await this.tradeRepo.update(
        {
          id: tradeId,
          status: In(ACTIVE_SETTLEMENT_STATUSES),
        },
        {
          status: TradeStatus.SETTLEMENT_DELAYED,
          settlementRetryCount,
          settlementFailureReason: this.toErrorMessage(error),
          lastSettlementAttemptAt,
          nextSettlementRetryAt,
        },
      );
    } else {
      this.logger.warn(
        `settleTrade skipped DELAYED transition for trade ${tradeId}: status ${current.status} is not an active settlement state`,
      );
    }

    throw error instanceof Error
      ? error
      : new Error('PULSE_TRADE_SETTLEMENT_FAILED');
  }

  /**
   * Duplicate/unique-violation shape detect karta hai (ledger idempotency
   * guard ya clientRequestId guard se aaya conflict).
   */
  private isSettlementIdempotencyConflict(error: unknown): boolean {
    if (this.isSettlementUniqueViolation(error)) return true;
    if (this.isClientRequestUniqueViolation(error)) return true;
    const message = this.toErrorMessage(error);
    return (
      message.includes('DUPLICATE') ||
      message.includes('23505') ||
      message.includes('IDX_ledger_trade_settlement_reference_unique') ||
      message.includes('IDX_ledger_trade_fee') ||
      message.includes('TRADE_SETTLEMENT') ||
      message.includes('already exists')
    );
  }

  /**
   * Generic Postgres unique-violation (23505) detector — ledger idempotency
   * guard ya kisi bhi partial unique index se aaya conflict.
   */
  private isSettlementUniqueViolation(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string };
      if (driverError?.code === '23505') return true;
    }
    if (typeof error === 'object' && error !== null) {
      const code = (error as { code?: unknown }).code;
      if (code === '23505') return true;
    }
    return false;
  }

  /**
   * Existing successful settlement ka proof: TRADE_SETTLEMENT referenceType
   * wala ledger row tradeId par maujood hai ya nahi.
   */
  private async findExistingSettlementProof(
    tradeId: string,
  ): Promise<{ settled: boolean }> {
    try {
      const existing = await this.dataSource.getRepository(LedgerEntry).findOne({
        where: {
          referenceId: tradeId,
          referenceType:
            PULSE_SETTLEMENT_POLICY.ledger.settlementReferenceType,
        },
      });
      return { settled: Boolean(existing) };
    } catch {
      return { settled: false };
    }
  }

  private payoutForTrade(
    trade: Pick<Trade, 'amount' | 'status' | 'result'>,
  ): string | null {
    if (trade.status !== TradeStatus.SETTLED || !trade.result) {
      return null;
    }

    const stake = this.parseAmount(trade.amount);
    return this.computePayout(stake, trade.result).toFixed(18);
  }

  async processExpiredTrades(): Promise<void> {
    const candidateTradeIds = await this.findExpiredTradeIdsForSettlement();

    for (const tradeId of candidateTradeIds) {
      try {
        await this.settleTrade(tradeId);
      } catch (error) {
        this.logger.warn(
          `Failed to settle expired trade ${tradeId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async findExpiredTradeIdsForSettlement(
    limit = this.getExpirySettlementBatchSize(),
  ): Promise<string[]> {
    const now = new Date();

    const candidates = await this.tradeRepo.find({
      where: {
        status: In(ACTIVE_SETTLEMENT_STATUSES),
        expiryAt: LessThanOrEqual(now),
      },
      order: { expiryAt: 'ASC', createdAt: 'ASC' },
      take: limit,
    });

    return candidates.map((trade) => trade.id);
  }

  async markTradeSettlementFailed(
    tradeId: string,
    reason: string,
    attemptsMade?: number,
    maxAttempts?: number,
  ): Promise<boolean> {
    // CRITICAL-1 race guard: conditional UPDATE — SETTLED (or any terminal /
    // non-active row) kabhi overwrite nahi hoga. Read-then-update nahi hai;
    // single atomic statement me status predicate hai.
    const normalizedAttemptsMade =
      typeof attemptsMade === 'number' &&
      Number.isFinite(attemptsMade) &&
      attemptsMade >= 0
        ? Math.trunc(attemptsMade)
        : undefined;

    const updateResult = await this.tradeRepo.update(
      {
        id: tradeId,
        status: In(ACTIVE_SETTLEMENT_STATUSES),
      },
      {
        status: TradeStatus.SETTLEMENT_FAILED,
        settlementFailureReason: reason,
        lastSettlementAttemptAt: new Date(),
        nextSettlementRetryAt: null,
        ...(normalizedAttemptsMade !== undefined
          ? { settlementRetryCount: normalizedAttemptsMade }
          : {}),
      },
    );

    const updated = Number(updateResult.affected ?? 0) > 0;

    if (updated) {
      this.logger.warn(
        `Trade ${tradeId} moved to SETTLEMENT_FAILED after settlement retries exhausted` +
          `${
            maxAttempts
              ? ` (${attemptsMade ?? maxAttempts}/${maxAttempts})`
              : attemptsMade
                ? ` (${attemptsMade})`
                : ''
          }: ${reason}`,
      );
      return true;
    }

    // affectedRows = 0 → trade ACTIVE list me nahi hai. Authoritative
    // re-read karke decide karo: SETTLED hai to idempotent success mano
    // (downgrade mat karo), terminal hai to chhuo mat.
    const current = await this.tradeRepo.findOne({
      where: { id: tradeId },
    });

    if (current?.status === TradeStatus.SETTLED) {
      this.logger.log(
        `markTradeSettlementFailed skipped for trade ${tradeId}: already SETTLED (idempotent success, no downgrade)`,
      );
      return false;
    }

    if (current) {
      this.logger.warn(
        `markTradeSettlementFailed skipped for trade ${tradeId}: status is ${current.status} (not an active settlement state, no transition applied)`,
      );
    }

    return false;
  }

  /**
   * HIGH-3 (settlement recovery): SETTLEMENT_FAILED trade ke liye controlled
   * admin recovery. Yeh method KABHI bhi khud balance credit, payout ledger
   * insert ya `SETTLED` set nahi karti — wo sab existing authoritative
   * `settleTrade()` (BullMQ worker ke through) karta hai.
   *
   * Recovery = conditional FAILED -> SETTLEMENT_DELAYED reset (CRITICAL-1
   * ke jaisa race-safe conditional UPDATE) + existing deterministic settle
   * job (pulseSettlementTradeJobId → BullMQ dedup) re-enqueue. Queue down
   * ho to 1s expiry scan khud DELAYED trade ko uthata hai (scan query
   * ACTIVE_SETTLEMENT_STATUSES + expiryAt <= now scan karti hai).
   */
  async requestSettlementRecovery(
    adminId: string,
    tradeId: string,
    dto: AdminSettlementRecoveryDto,
    context: { ipAddress: string | null; userAgent: string | null },
  ): Promise<SettlementRecoveryResult> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) {
      throw new NotFoundException('TRADE_NOT_FOUND');
    }

    const previousStatus = trade.status;
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';

    // Idempotent replay — trade pehle se SETTLED hai: koi payout, koi ledger,
    // koi status change nahi. Sirf audited result.
    if (trade.status === TradeStatus.SETTLED) {
      await this.auditSettlementRecovery(
        adminId,
        trade,
        previousStatus,
        TradeStatus.SETTLED,
        'ALREADY_SETTLED',
        context,
        reason,
      );
      return {
        tradeId,
        previousStatus,
        action: 'ALREADY_SETTLED',
        status: TradeStatus.SETTLED,
        jobId: null,
      };
    }

    // Sirf SETTLEMENT_FAILED recoverable hai. Active states (ACCEPTED /
    // ENTRY_CLOSED / EXPIRING / SETTLING / SETTLEMENT_DELAYED) already
    // existing pipeline me hain; REJECTED / CANCELLED irrecoverable terminal
    // hain. Koi force-settle path nahi.
    if (trade.status !== TradeStatus.SETTLEMENT_FAILED) {
      await this.auditSettlementRecovery(
        adminId,
        trade,
        previousStatus,
        previousStatus,
        'REJECTED_NOT_RECOVERABLE',
        context,
        reason,
      );
      throw new ConflictException(
        'SETTLEMENT_RECOVERY_NOT_ELIGIBLE: trade is not in SETTLEMENT_FAILED state',
      );
    }

    // Eligibility: authoritative settlement data maujood hona chahiye.
    // Outcome/payout/price kabhi admin set nahi karta — settleTrade derive
    // karta hai.
    if (!trade.pair || !trade.amount || !trade.entryPrice || !trade.expiryAt) {
      await this.auditSettlementRecovery(
        adminId,
        trade,
        previousStatus,
        previousStatus,
        'REJECTED_DATA_MISSING',
        context,
        reason,
      );
      throw new ConflictException('SETTLEMENT_RECOVERY_DATA_MISSING');
    }

    // CRITICAL-1-consistent race guard: single conditional UPDATE — sirf
    // FAILED -> SETTLEMENT_DELAYED. Agar concurrent worker settlement beech
    // me SETTLED kar de to affectedRows = 0 aur hum override nahi karte.
    const updateResult = await this.tradeRepo.update(
      { id: tradeId, status: TradeStatus.SETTLEMENT_FAILED },
      {
        status: TradeStatus.SETTLEMENT_DELAYED,
        settlementRetryCount: 0,
        settlementFailureReason: null,
        lastSettlementAttemptAt: new Date(),
        nextSettlementRetryAt: null,
      },
    );

    if (Number(updateResult.affected ?? 0) === 0) {
      const current = await this.tradeRepo.findOne({
        where: { id: tradeId },
      });

      if (current?.status === TradeStatus.SETTLED) {
        await this.auditSettlementRecovery(
          adminId,
          trade,
          previousStatus,
          TradeStatus.SETTLED,
          'ALREADY_SETTLED',
          context,
          reason,
        );
        return {
          tradeId,
          previousStatus,
          action: 'ALREADY_SETTLED',
          status: TradeStatus.SETTLED,
          jobId: null,
        };
      }

      await this.auditSettlementRecovery(
        adminId,
        trade,
        previousStatus,
        current?.status ?? previousStatus,
        'RACE_CONFLICT',
        context,
        reason,
      );
      throw new ConflictException(
        'SETTLEMENT_RECOVERY_STATE_CHANGED: trade state changed during recovery',
      );
    }

    return this.enqueueSettlementRecoveryJob(adminId, trade, previousStatus, context, reason);
  }

  /**
   * Existing deterministic settlement job me re-queue — same job name, same
   * deterministic jobId (BullMQ duplicate active job dedup karta hai), same
   * attempts/backoff jo scan jobs use karte hain. Koi parallel/second
   * settlement implementation nahi.
   */
  private async enqueueSettlementRecoveryJob(
    adminId: string,
    trade: Trade,
    previousStatus: TradeStatus,
    context: { ipAddress: string | null; userAgent: string | null },
    reason: string,
  ): Promise<SettlementRecoveryResult> {
    let jobId: string | null = null;
    if (this.settlementQueue) {
      try {
        jobId = pulseSettlementTradeJobId(trade.id);
        await this.settlementQueue.add(
          PULSE_SETTLEMENT_SETTLE_JOB,
          { tradeId: trade.id },
          {
            jobId,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        );
      } catch (error) {
        // Redis/queue unavailable: recovery reset (DELAYED + expired) DB me
        // already hai — existing 1s scan ise utha lega. Queue failure
        // recovery ko block nahi karti.
        jobId = null;
        this.logger.warn(
          `Pulse settlement recovery enqueue failed for trade ${trade.id}; falling back to expiry scan: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.auditSettlementRecovery(
      adminId,
      trade,
      previousStatus,
      TradeStatus.SETTLEMENT_DELAYED,
      'RECOVERY_QUEUED',
      context,
      reason,
    );

    return {
      tradeId: trade.id,
      previousStatus,
      action: 'RECOVERY_QUEUED',
      status: TradeStatus.SETTLEMENT_DELAYED,
      jobId,
    };
  }

  private async auditSettlementRecovery(
    adminId: string,
    trade: Pick<Trade, 'id' | 'userId' | 'pair' | 'amount'>,
    previousStatus: TradeStatus,
    resultingStatus: TradeStatus,
    result: string,
    context: { ipAddress: string | null; userAgent: string | null },
    reason: string,
  ): Promise<void> {
    try {
      const auditRepo = this.dataSource.getRepository(AdminAuditLog);
      await auditRepo.save(
        auditRepo.create({
          adminId,
          action: PULSE_SETTLEMENT_RECOVERY_AUDIT_ACTION,
          targetType: PULSE_SETTLEMENT_RECOVERY_AUDIT_TARGET_TYPE,
          targetId: trade.id,
          oldValue: { status: previousStatus },
          newValue: { status: resultingStatus },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            tradeId: trade.id,
            userId: trade.userId,
            pair: trade.pair,
            amount: trade.amount,
            result,
            reason: reason || null,
          },
        }),
      );
    } catch (error) {
      // Audit write fail ho to recovery action block na ho — par loudly log
      // karo (audit trail operators ke liye critical hai).
      this.logger.error(
        `Failed to write pulse settlement recovery audit log for trade ${trade.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private determineTradeResult(
    direction: TradeDirection,
    entryPrice: Decimal,
    expiryPrice: Decimal,
  ): TradeResult {
    const comparison = expiryPrice.comparedTo(entryPrice);

    if (comparison === 0) {
      return TradeResult.DRAW;
    }

    if (direction === TradeDirection.LONG) {
      return comparison > 0 ? TradeResult.WIN : TradeResult.LOSS;
    }

    return comparison < 0 ? TradeResult.WIN : TradeResult.LOSS;
  }

  private computePayout(stake: Decimal, result: TradeResult): Decimal {
    if (result === TradeResult.WIN) {
      return this.computeTradeFeeBreakdown(stake).netStake.mul(
        PULSE_SETTLEMENT_POLICY.payout.winMultiplier,
      );
    }

    if (result === TradeResult.DRAW) {
      return stake.mul(PULSE_SETTLEMENT_POLICY.payout.drawMultiplier);
    }

    return new Decimal(PULSE_SETTLEMENT_POLICY.payout.lossPayout);
  }

  private computeTradeFeeBreakdown(amount: Decimal): TradeFeeBreakdown {
    const totalFee = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.fee.totalPercent,
    );
    const referral = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.referral.totalPercent,
    );
    const admin = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.admin.allocationPercent,
    );
    const bonusVault = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.bonusVault.allocationPercent,
    );
    const netStake = amount.minus(totalFee);

    return {
      totalFee,
      netStake,
      referral,
      admin,
      bonusVault,
    };
  }

  private toSettlementResult(trade: Trade): SettlementResult {
    if (!trade.exitPrice || !trade.result || !trade.settledAt) {
      throw new ConflictException('TRADE_NOT_SETTLED');
    }

    const stake = this.parseAmount(trade.amount);
    const payout = this.computePayout(stake, trade.result);

    return {
      tradeId: trade.id,
      status: trade.status,
      result: trade.result,
      entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
      expiryPrice: this.parseAmount(trade.exitPrice).toFixed(18),
      payout: payout.toFixed(18),
      settledAt: trade.settledAt.toISOString(),
    };
  }

  private getExpirySettlementBatchSize(): number {
    const raw =
      this.configService.get<string>('PULSE_EXPIRY_SETTLEMENT_BATCH_SIZE') ??
      '25';
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 25;
    }
    return Math.min(parsed, 200);
  }

  private getSettlementRetryDelaySeconds(): number {
    const raw =
      this.configService.get<string>('PULSE_SETTLEMENT_RETRY_DELAY_SECONDS') ??
      '30';
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 30;
    }

    return Math.min(parsed, 3600);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return String(error);
  }

  private async getOrCreateBalanceForUpdate(
    balanceRepo: Repository<Balance>,
    userId: string,
  ): Promise<Balance> {
    let balance = await balanceRepo.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (balance) {
      return balance;
    }

    const zero = '0.000000000000000000';
    balance = balanceRepo.create({
      userId,
      availableBalance: zero,
      lockedBalance: zero,
      gameLocked: zero,
      tradingLocked: zero,
      withdrawalLocked: zero,
      totalBalance: zero,
    });

    return balanceRepo.save(balance);
  }

  private async resolveReferralDistributionTargets(
    manager: EntityManager,
    userId: string,
  ): Promise<ReferralDistributionTarget[]> {
    const userRepo = manager.getRepository(User);
    const loadUser = async (
      id: string,
    ): Promise<Pick<User, 'id' | 'referredBy'> | null> => {
      if (typeof userRepo.findOne !== 'function') {
        return null;
      }

      return userRepo.findOne({
        where: { id },
        select: {
          id: true,
          referredBy: true,
        },
      });
    };

    const targets: ReferralDistributionTarget[] = [];
    let currentUserId = userId;

    for (let level = 1; level <= 6; level += 1) {
      const currentUser = await loadUser(currentUserId);

      if (!currentUser?.referredBy) {
        for (
          let fallbackLevel = level;
          fallbackLevel <= 6;
          fallbackLevel += 1
        ) {
          targets.push({ level: fallbackLevel, ancestorUserId: null });
        }
        break;
      }

      const ancestor = await loadUser(currentUser.referredBy);

      if (!ancestor) {
        for (
          let fallbackLevel = level;
          fallbackLevel <= 6;
          fallbackLevel += 1
        ) {
          targets.push({ level: fallbackLevel, ancestorUserId: null });
        }
        break;
      }

      targets.push({ level, ancestorUserId: ancestor.id });
      currentUserId = ancestor.id;
    }

    return targets;
  }

  private parsePositiveAmount(value: unknown, field: string): Decimal {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} must be a valid decimal string`);
    }

    const normalized = value.trim();

    let parsed: Decimal;
    try {
      parsed = new Decimal(normalized);
    } catch {
      throw new BadRequestException(`${field} must be a valid decimal string`);
    }

    if (!parsed.isFinite() || parsed.lte(0)) {
      throw new BadRequestException(`${field} must be greater than zero`);
    }

    return parsed;
  }

  private parseAmount(value: string | number | null | undefined): Decimal {
    try {
      return new Decimal(String(value ?? '0'));
    } catch {
      return new Decimal(0);
    }
  }

  private normalizeSymbolOrThrow(symbol: string): SupportedTradeSymbol {
    const normalized = normalizePulseSymbol(symbol);
    if (!isSupportedPulsePair(normalized)) {
      throw new BadRequestException(
        `INVALID_SYMBOL: Unsupported pulse symbol ${symbol}`,
      );
    }
    return normalized;
  }

  private normalizeDurationOrThrow(
    duration: string,
  ): PulseSupportedDurationCode {
    const normalized = duration.toUpperCase();
    if (!isSupportedPulseDurationCode(normalized)) {
      throw new BadRequestException(
        `INVALID_DURATION: Unsupported duration ${duration}`,
      );
    }
    return normalized;
  }

  private ensureDurationCutoff(
    now: Date,
    durationSeconds: PulseSupportedDurationSeconds,
  ): void {
    if (durationSeconds !== PULSE_30S_DURATION_SECONDS) {
      return;
    }

    const secondsInMinute = now.getUTCSeconds();
    const elapsedInWindow = secondsInMinute % PULSE_30S_DURATION_SECONDS;
    const remainingToWindowEnd = PULSE_30S_DURATION_SECONDS - elapsedInWindow;

    if (remainingToWindowEnd <= PULSE_30S_CUTOFF_SECONDS) {
      throw new ConflictException(
        'TRADING_CUTOFF_REACHED: Trading locked for final 10 seconds',
      );
    }
  }

  private percentOf(amount: Decimal, percent: string): Decimal {
    return amount.mul(new Decimal(percent)).div(100);
  }

  private publicStatus(trade: Trade): string {
    switch (trade.status) {
      case TradeStatus.ACCEPTED:
        return 'OPEN';
      case TradeStatus.ENTRY_CLOSED:
      case TradeStatus.EXPIRING:
        return 'LOCKED';
      case TradeStatus.SETTLING:
        return 'SETTLING';
      case TradeStatus.SETTLEMENT_DELAYED:
        return 'SETTLEMENT_DELAYED';
      case TradeStatus.SETTLEMENT_FAILED:
        return 'SETTLEMENT_FAILED';
      case TradeStatus.REJECTED:
        return 'REJECTED';
      case TradeStatus.CANCELLED:
        return 'CANCELLED';
      case TradeStatus.SETTLED:
        if (trade.result === TradeResult.WIN) return 'WON';
        if (trade.result === TradeResult.LOSS) return 'LOST';
        if (trade.result === TradeResult.DRAW) return 'DRAW';
        return 'SETTLED';
      default:
        return trade.status;
    }
  }

  private remainingSeconds(now: Date, expiresAt: Date): number {
    const diffMs = expiresAt.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / 1000);
  }

  private toPlaceTradeResult(
    trade: Trade,
    balanceSnapshot: { available: string; locked: string; total: string },
  ): PlaceTradeResult {
    const durationCode = this.durationCodeFromTrade(trade.duration);
    const amount = this.parseAmount(trade.amount);
    const feeBreakdown = this.computeTradeFeeBreakdown(amount);

    return {
      trade: {
        id: trade.id,
        symbol: trade.pair,
        direction: trade.direction,
        duration: durationCode,
        stake: amount.toFixed(18),
        fee: feeBreakdown.totalFee.toFixed(18),
        netStake: feeBreakdown.netStake.toFixed(18),
        entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
        entryAt: trade.createdAt.toISOString(),
        expiresAt: trade.expiryAt.toISOString(),
        status: this.publicStatus(trade),
        result: trade.result ?? null,
        payout: this.payoutForTrade(trade),
        remainingSeconds: this.remainingSeconds(new Date(), trade.expiryAt),
      },
      feeBreakdown: {
        totalFee: feeBreakdown.totalFee.toFixed(18),
        referral: feeBreakdown.referral.toFixed(18),
        admin: feeBreakdown.admin.toFixed(18),
        bonusVault: feeBreakdown.bonusVault.toFixed(18),
      },
      balance: balanceSnapshot,
    };
  }

  private toOpenTradeView(trade: Trade) {
    const amount = this.parseAmount(trade.amount);
    const fee = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.fee.totalPercent,
    );

    return {
      id: trade.id,
      symbol: trade.pair,
      direction: trade.direction,
      duration: this.durationCodeFromTrade(trade.duration),
      stake: amount.toFixed(18),
      fee: fee.toFixed(18),
      entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
      currentPrice: this.parseAmount(trade.entryPrice).toFixed(18),
      entryAt: trade.createdAt.toISOString(),
      expiresAt: trade.expiryAt.toISOString(),
      remainingSeconds: this.remainingSeconds(new Date(), trade.expiryAt),
      status: this.publicStatus(trade),
    };
  }

  private toHistoryTradeView(trade: Trade) {
    const amount = this.parseAmount(trade.amount);
    const fee = this.percentOf(
      amount,
      PULSE_SETTLEMENT_POLICY.fee.totalPercent,
    );

    return {
      id: trade.id,
      symbol: trade.pair,
      direction: trade.direction,
      duration: this.durationCodeFromTrade(trade.duration),
      stake: amount.toFixed(18),
      fee: fee.toFixed(18),
      entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
      expiryPrice: trade.exitPrice
        ? this.parseAmount(trade.exitPrice).toFixed(18)
        : null,
      entryAt: trade.createdAt.toISOString(),
      expiresAt: trade.expiryAt.toISOString(),
      settledAt: trade.settledAt ? trade.settledAt.toISOString() : null,
      status: this.publicStatus(trade),
      result: trade.result ?? null,
      payout: this.payoutForTrade(trade),
    };
  }

  private applyDateFilters(
    qb: SelectQueryBuilder<Trade>,
    from?: string,
    to?: string,
  ): void {
    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('Invalid from date');
      }
      qb.andWhere('trade.createdAt >= :from', { from: fromDate.toISOString() });
    }

    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException('Invalid to date');
      }
      qb.andWhere('trade.createdAt <= :to', { to: toDate.toISOString() });
    }
  }

  private durationCodeFromTrade(
    durationSeconds: number,
  ): PulseSupportedDurationCode {
    return pulseDurationSecondsToCode(
      durationSeconds as PulseSupportedDurationSeconds,
    );
  }

  private async getUserBalanceSnapshot(
    userId: string,
  ): Promise<{ available: string; locked: string; total: string }> {
    const balance = await this.balanceRepo.findOne({ where: { userId } });

    return {
      available: this.parseAmount(balance?.availableBalance ?? '0').toFixed(18),
      locked: this.parseAmount(balance?.lockedBalance ?? '0').toFixed(18),
      total: this.parseAmount(balance?.totalBalance ?? '0').toFixed(18),
    };
  }

  private isClientRequestUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
    };

    return (
      driverError?.code === '23505' &&
      driverError?.constraint === 'IDX_pulse_trades_user_clientRequestId_unique'
    );
  }
}
