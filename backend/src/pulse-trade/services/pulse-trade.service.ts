import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';

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

type SupportedTradeSymbol = PulseSupportedPair;

const TERMINAL_NON_SETTLABLE_STATUSES: TradeStatus[] = [
  TradeStatus.REJECTED,
  TradeStatus.CANCELLED,
  TradeStatus.SETTLEMENT_FAILED,
];

const PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY = 'PULSE_LIQUIDITY_POOL_BALANCE';
const PULSE_LIQUIDITY_AUDIT_ACTION = 'PULSE_LIQUIDITY_ADJUSTMENT';
const PULSE_LIQUIDITY_AUDIT_TARGET_TYPE = 'pulse_liquidity';
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

    let persistedTrade: Trade;

    try {
      persistedTrade = await this.dataSource.transaction(async (manager) => {
        const txBalanceRepo = manager.getRepository(Balance);
        const txTradeRepo = manager.getRepository(Trade);
        const txLedgerRepo = manager.getRepository(LedgerEntry);

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

          await txLedgerRepo.save(distributionEntry);
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

        return savedTrade;
      });
    } catch (error) {
      if (this.isClientRequestUniqueViolation(error)) {
        const replay = await this.tradeRepo.findOne({
          where: { userId, clientRequestId },
          order: { createdAt: 'DESC' },
        });

        if (replay) {
          return this.toPlaceTradeResult(
            replay,
            await this.getUserBalanceSnapshot(userId),
          );
        }
      }

      throw error;
    }

    return this.toPlaceTradeResult(
      persistedTrade,
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

    const settledTrade = await this.dataSource.transaction(async (manager) => {
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
      const currentlyTradingLocked = this.parseAmount(balance.tradingLocked);

      if (currentlyLocked.lt(stake) || currentlyTradingLocked.lt(stake)) {
        throw new ConflictException('BALANCE_LOCK_MISMATCH_FOR_SETTLEMENT');
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
    });

    return this.toSettlementResult(settledTrade);
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
    }

    return updated;
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
