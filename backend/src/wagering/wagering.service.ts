import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import Decimal from 'decimal.js';

import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { Deposit, DepositStatus } from '../deposits/deposit.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { LottoTicket } from '../modules/lotto/entities/lotto-ticket.entity';
import { Trade } from '../pulse-trade/entities/trade.entity';

import {
  WageringObligation,
  WageringObligationStatus,
} from './entities/wagering-obligation.entity';
import {
  WageringEvent,
  WageringActivityType,
  WageringEventStatus,
} from './entities/wagering-event.entity';
import {
  WageringNotification,
  WageringNotificationKind,
} from './entities/wagering-notification.entity';
import {
  EligibleActivity,
  WageringSettings,
} from './entities/wagering-settings.entity';
import { WageringUserOverride } from './entities/wagering-user-override.entity';
import {
  WAGERING_SETTINGS_CONFLICT_CODE,
  WAGERING_WITHDRAWAL_BLOCKED_CODE,
} from './dto/wagering.dto';

export const LOTTO_SOURCE_TYPE = 'LOTTO_TICKET';
export const TRADE_SOURCE_TYPE = 'PULSE_TRADE';
export const SURPLUS_REJECT_REASON = 'NO_ACTIVE_OBLIGATION';

export {
  WageringActivityType,
  WageringEventStatus,
} from './entities/wagering-event.entity';

const DECIMAL_PLACES = 18;

const fixed = (value: Decimal): string => value.toFixed(DECIMAL_PLACES);
const dec = (value: string | number | Decimal): Decimal =>
  new Decimal(String(value));

export interface RecordWageredVolumeInput {
  userId: string;
  activityType: WageringActivityType;
  sourceType: string;
  sourceId: string;
  amount: string;
  ledgerType: string;
  /**
   * REQUIRED settlement outcome. Volume is only ever counted when this is
   * exactly 'SETTLED' — omitted, unknown, or cancelled/refunded/reversed/
   * failed outcomes are refused outright, so a future call site can never
   * accidentally count non-settled activity by forgetting the field.
   */
  settlementOutcome: WageringSettlementOutcome;
}

export type WageringSettlementOutcome =
  | 'SETTLED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REVERSED'
  | 'FAILED';

/**
 * Fee-excluded wagering stake — exact Decimal arithmetic only, never floats.
 * Only the stake that actually contributes to the wagering pool counts:
 * fees (lotto 3% deduction already reflected in ticket.netAmount, pulse trade
 * fee legs) are subtracted and the result is clamped at zero so a
 * fee-dominated record can never produce negative volume.
 */
export function netStakeAfterFees(
  stake: string | number | Decimal,
  feeAmounts: Array<string | number | Decimal>,
): string {
  let net = dec(stake);
  for (const fee of feeAmounts) {
    const feeValue = dec(fee);
    if (feeValue.lte(0)) continue;
    net = net.minus(feeValue);
  }
  return fixed(net.lt(0) ? dec(0) : net);
}

export interface WageringCheckResult {
  allowed: boolean;
  remainingWagering: string;
  obligationIds: string[];
}

@Injectable()
export class WageringService {
  private readonly logger = new Logger(WageringService.name);

  constructor(
    @InjectRepository(WageringSettings)
    private readonly settingsRepo: Repository<WageringSettings>,
    @InjectRepository(WageringUserOverride)
    private readonly overrideRepo: Repository<WageringUserOverride>,
    @InjectRepository(WageringObligation)
    private readonly obligationRepo: Repository<WageringObligation>,
    @InjectRepository(WageringEvent)
    private readonly eventRepo: Repository<WageringEvent>,
    @InjectRepository(WageringNotification)
    private readonly notificationRepo: Repository<WageringNotification>,
    @InjectRepository(AdminAuditLog)
    private readonly auditRepo: Repository<AdminAuditLog>,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(LottoTicket)
    private readonly lottoTicketRepo: Repository<LottoTicket>,
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
  ) {}

  // ============================================================
  // SETTINGS (singleton row, self-healing, versioned updates)
  // ============================================================

  async getSettings(manager?: EntityManager): Promise<WageringSettings> {
    const repo = manager
      ? manager.getRepository(WageringSettings)
      : this.settingsRepo;
    let settings = await repo.findOne({ where: { singletonKey: 1 } });
    if (!settings) {
      // Self-heal after manual drift — insert the singleton default. The PK
      // CHECK (singletonKey = 1) makes a second row impossible.
      settings = await repo.save(
        repo.create({
          singletonKey: 1,
          allowedMultipliers: [1, 2, 3, 5, 10],
        }),
      );
    }
    return settings;
  }

  async updateSettings(
    adminId: string,
    dto: {
      wageringEnabled?: boolean;
      defaultMultiplier?: number;
      allowedMultipliers?: number[];
      eligibleActivity?: EligibleActivity;
      withdrawalEnforcement?: boolean;
      notifyUsers?: boolean;
      expiryDays?: number;
      reconciliationMaxAgeDays?: number;
      reason: string;
    },
  ): Promise<WageringSettings> {
    return this.settingsRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WageringSettings);
      const current = await repo.findOne({
        where: { singletonKey: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) {
        throw new NotFoundException('Wagering settings not found');
      }

      const targetDefault =
        dto.defaultMultiplier ?? current.defaultMultiplier;
      const targetAllowlist =
        dto.allowedMultipliers ?? current.allowedMultipliers;
      if (
        new Set(targetAllowlist).size !== targetAllowlist.length ||
        !targetAllowlist.includes(targetDefault)
      ) {
        throw new NotFoundException(
          'Default multiplier must be a unique member of the allowed multipliers',
        );
      }

      const wasEnabled = current.wageringEnabled;
      const willEnable = dto.wageringEnabled ?? current.wageringEnabled;

      current.wageringEnabled = willEnable;
      if (dto.defaultMultiplier !== undefined) {
        current.defaultMultiplier = dto.defaultMultiplier;
      }
      if (dto.allowedMultipliers !== undefined) {
        current.allowedMultipliers = dto.allowedMultipliers;
      }
      if (dto.eligibleActivity !== undefined) {
        current.eligibleActivity = dto.eligibleActivity;
      }
      if (dto.withdrawalEnforcement !== undefined) {
        current.withdrawalEnforcement = dto.withdrawalEnforcement;
      }
      if (dto.notifyUsers !== undefined) current.notifyUsers = dto.notifyUsers;
      if (dto.expiryDays !== undefined) current.expiryDays = dto.expiryDays;
      if (dto.reconciliationMaxAgeDays !== undefined) {
        current.reconciliationMaxAgeDays = dto.reconciliationMaxAgeDays;
      }
      // Activation timestamp: set only on the false -> true transition so
      // deposits credited before wagering was enabled never create obligations.
      if (!wasEnabled && willEnable && !current.activationTimestamp) {
        current.activationTimestamp = new Date();
      }
      current.policyVersion += 1;
      current.updatedBy = adminId;
      const saved = await repo.save(current);

      await this.writeAudit(manager, {
        adminId,
        action: 'WAGERING_SETTINGS_UPDATE',
        targetId: '1',
        oldValue: { policyVersion: saved.policyVersion - 1 },
        newValue: {
          reason: dto.reason,
          policyVersion: saved.policyVersion,
          wageringEnabled: saved.wageringEnabled,
          defaultMultiplier: saved.defaultMultiplier,
          allowedMultipliers: saved.allowedMultipliers,
          eligibleActivity: saved.eligibleActivity,
          withdrawalEnforcement: saved.withdrawalEnforcement,
        },
      });

      return saved;
    });
  }

  // ============================================================
  // EFFECTIVE MULTIPLIER (override wins, else global default)
  // ============================================================

  async resolveEffectiveMultiplier(
    userId: string,
  ): Promise<{ multiplier: number; source: 'USER_OVERRIDE' | 'GLOBAL_DEFAULT' }> {
    const override = await this.overrideRepo.findOne({ where: { userId } });
    if (override) {
      return { multiplier: override.multiplier, source: 'USER_OVERRIDE' };
    }
    const settings = await this.getSettings();
    return { multiplier: settings.defaultMultiplier, source: 'GLOBAL_DEFAULT' };
  }

  private isActivityEligible(
    activityType: WageringActivityType,
    settings: WageringSettings,
  ): boolean {
    if (settings.eligibleActivity === EligibleActivity.BOTH) return true;
    return (
      settings.eligibleActivity ===
      (activityType === WageringActivityType.LOTTO
        ? EligibleActivity.LOTTO
        : EligibleActivity.TRADE)
    );
  }

  // ============================================================
  // OBLIGATION CREATION (per eligible deposit; snapshot at creation)
  // ============================================================

  /**
   * Called (non-blocking, try/catch) by the deposit-credit processor after the
   * DEPOSIT ledger entry commits. Idempotent via UNIQUE(depositId).
   * Returns true when an obligation exists after the call.
   */
  async onDepositCredited(deposit: Deposit, ledgerEntryId: string): Promise<boolean> {
    try {
      return await this.createObligationForDeposit(deposit, ledgerEntryId);
    } catch (error) {
      // Never block or fail deposit crediting — reconciliation will repair.
      this.logger.warn(
        `Wagering obligation creation failed for deposit ${deposit.id}: ${String(error)}`,
      );
      return false;
    }
  }

  /** Idempotent obligation creation with full creation-time snapshots. */
  async createObligationForDeposit(
    deposit: Deposit,
    ledgerEntryId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const run = async (em: EntityManager): Promise<boolean> => {
      const settings = await this.getSettings(em);
      if (!settings.wageringEnabled) return false;
      if (deposit.status !== DepositStatus.COMPLETED) return false;

      // Activation cutoff: deposits credited before wagering was enabled
      // (or with no activation timestamp) never create obligations.
      if (
        !settings.activationTimestamp ||
        !deposit.creditedAt ||
        deposit.creditedAt < settings.activationTimestamp
      ) {
        return false;
      }

      const existing = await em
        .getRepository(WageringObligation)
        .findOne({ where: { depositId: deposit.id } });
      if (existing) return true; // idempotent — exactly one obligation per deposit

      const { multiplier } = await this.resolveEffectiveMultiplier(deposit.userId);

      const sourceUsdt = dec(deposit.usdtAmount);
      const sourceTdx = dec(deposit.tdxAmount);
      if (sourceTdx.lte(0)) return false;

      // Snapshot conversion rate from the immutable deposit row — the
      // obligation is never recalculated with a later rate.
      const conversionRate = sourceTdx.div(sourceUsdt).toFixed(DECIMAL_PLACES);
      const required = sourceTdx.mul(multiplier);

      const expiresAt =
        settings.expiryDays > 0
          ? new Date(Date.now() + settings.expiryDays * 86_400_000)
          : null;

      const obligation = await em
        .getRepository(WageringObligation)
        .save(
          em.getRepository(WageringObligation).create({
            userId: deposit.userId,
            depositId: deposit.id,
            ledgerEntryId,
            sourceUsdtAmount: fixed(sourceUsdt),
            sourceTdxAmount: fixed(sourceTdx),
            conversionRate,
            depositAmountTdx: fixed(sourceTdx),
            multiplier,
            requiredAmount: fixed(required),
            completedAmount: fixed(dec(0)),
            status: WageringObligationStatus.ACTIVE,
            policyVersion: settings.policyVersion,
            eligibleActivity: settings.eligibleActivity,
            expiresAt,
          }),
        );

      if (settings.notifyUsers) {
        await this.queueNotification(em, deposit.userId, WageringNotificationKind.OBLIGATION_CREATED, {
          obligationId: obligation.id,
          multiplier,
          requiredAmount: obligation.requiredAmount,
        });
      }
      return true;
    };

    if (manager) return run(manager);
    return this.obligationRepo.manager.transaction(run);
  }

  // ============================================================
  // DETERMINISTIC FIFO WAGERING ALLOCATION
  // ============================================================

  /**
   * Records settled wagering volume and allocates it FIFO across the user's
   * ACTIVE obligations, atomically and exactly-once:
   *
   *  1. Lock ACTIVE obligations FOR UPDATE in FIFO order (createdAt, id).
   *  2. Exact Decimal allocation across obligations.
   *  3. One wagering_events row per allocation leg
   *     (UNIQUE(sourceType, sourceId, legIndex) gates idempotency).
   *  4. REJECTED surplus row for any unallocated remainder.
   *  5. completedAmount/status updated atomically in the same transaction.
   *  6. Duplicate/retry verifies existing legs; NO volume added again.
   */
  async recordWageredVolume(
    input: RecordWageredVolumeInput,
  ): Promise<{
    status: 'COUNTED' | 'ALREADY_COUNTED' | 'NO_OBLIGATIONS' | 'NOT_SETTLED';
  }> {
    // Volume is counted ONLY for settled activity — omitted/unknown outcomes
    // (and cancelled/refunded/reversed/failed) are refused before any read
    // or write.
    if (input.settlementOutcome !== 'SETTLED') {
      return { status: 'NOT_SETTLED' };
    }

    const wagered = dec(input.amount);
    if (wagered.lte(0)) {
      return { status: 'NO_OBLIGATIONS' };
    }

    return this.eventRepo.manager.transaction(async (manager) => {
      const eventRepo = manager.getRepository(WageringEvent);
      const obligationRepo = manager.getRepository(WageringObligation);

      // Idempotency gate: verify existing legs for this source first.
      const existingLegs = await eventRepo.find({
        where: { sourceType: input.sourceType, sourceId: input.sourceId },
      });
      if (existingLegs.length > 0) {
        return { status: 'ALREADY_COUNTED' };
      }

      const settings = await this.getSettings(manager);
      if (!settings.wageringEnabled) {
        return { status: 'NO_OBLIGATIONS' };
      }
      if (!this.isActivityEligible(input.activityType, settings)) {
        return { status: 'NO_OBLIGATIONS' };
      }

      const now = new Date();

      // Expire-first pass: flip overdue ACTIVE obligations in this transaction
      // so a lapsed obligation can never absorb new wagering volume.
      await this.expireOverdueObligations(obligationRepo, input.userId);

      // 1. FIFO lock: createdAt ASC, id ASC — deterministic order.
      const obligations = await obligationRepo
        .createQueryBuilder('o')
        .where('o.userId = :userId AND o.status = :status', {
          userId: input.userId,
          status: WageringObligationStatus.ACTIVE,
        })
        .orderBy('o.createdAt', 'ASC')
        .addOrderBy('o.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();

      if (obligations.length === 0) {
        // Surplus row preserved for audit; never silently dropped.
        await eventRepo.save(
          eventRepo.create({
            userId: input.userId,
            activityType: input.activityType,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            legIndex: 0,
            ledgerType: input.ledgerType,
            obligationId: null,
            wageredAmount: fixed(wagered),
            allocatedAmount: fixed(dec(0)),
            status: WageringEventStatus.REJECTED,
            rejectReason: SURPLUS_REJECT_REASON,
            policyVersion: settings.policyVersion,
          }),
        );
        return { status: 'NO_OBLIGATIONS' };
      }

      return this.allocateAndPersist(
        manager,
        input,
        wagered,
        obligations,
        settings.policyVersion,
        now,
        settings.notifyUsers,
      );
    });
  }

  /** Steps 2-6 of the allocation: exact legs, surplus row, atomic updates. */
  private async allocateAndPersist(
    manager: EntityManager,
    input: RecordWageredVolumeInput,
    wagered: Decimal,
    obligations: WageringObligation[],
    policyVersion: number,
    now: Date,
    notifyUsers: boolean,
  ): Promise<{ status: 'COUNTED' }> {
    const eventRepo = manager.getRepository(WageringEvent);
    const obligationRepo = manager.getRepository(WageringObligation);

    let unallocated = wagered;
    const legs: Array<{ obligation: WageringObligation; allocate: Decimal }> = [];

    for (const obligation of obligations) {
      if (unallocated.lte(0)) break;
      const remaining = dec(obligation.requiredAmount).minus(
        dec(obligation.completedAmount),
      );
      if (remaining.lte(0)) continue;
      const allocate = Decimal.min(remaining, unallocated);
      legs.push({ obligation, allocate });
      unallocated = unallocated.minus(allocate);
    }

    for (let i = 0; i < legs.length; i += 1) {
      const { obligation, allocate } = legs[i];
      await eventRepo.save(
        eventRepo.create({
          userId: input.userId,
          activityType: input.activityType,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          legIndex: i,
          ledgerType: input.ledgerType,
          obligationId: obligation.id,
          wageredAmount: fixed(wagered),
          allocatedAmount: fixed(allocate),
          status: WageringEventStatus.COUNTED,
          policyVersion,
        }),
      );
    }

    if (unallocated.gt(0)) {
      await eventRepo.save(
        eventRepo.create({
          userId: input.userId,
          activityType: input.activityType,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          legIndex: legs.length,
          ledgerType: input.ledgerType,
          obligationId: null,
          wageredAmount: fixed(wagered),
          allocatedAmount: fixed(dec(0)),
          status: WageringEventStatus.REJECTED,
          rejectReason: SURPLUS_REJECT_REASON,
          policyVersion,
        }),
      );
    }

    const completedNow: string[] = [];
    for (const { obligation, allocate } of legs) {
      const newCompleted = dec(obligation.completedAmount).plus(allocate);
      obligation.completedAmount = fixed(newCompleted);
      if (newCompleted.gte(dec(obligation.requiredAmount))) {
        obligation.status = WageringObligationStatus.COMPLETED;
        obligation.completedAt = now;
        completedNow.push(obligation.id);
      }
      await obligationRepo.save(obligation);
    }

    if (notifyUsers) {
      for (const obligationId of completedNow) {
        await this.queueNotification(
          manager,
          input.userId,
          WageringNotificationKind.OBLIGATION_COMPLETED,
          { obligationId },
        );
      }
    }

    return { status: 'COUNTED' };
  }

  // ============================================================
  // EXPIRY (shared by summary + enforcement + allocation)
  // ============================================================

  /**
   * Atomically flips overdue ACTIVE obligations to EXPIRED. Used before
   * summaries, withdrawal enforcement, and volume allocation so a lapsed
   * obligation can never block a withdrawal or absorb new wagering volume.
   * Rows are updated in place — nothing is deleted; snapshots are preserved.
   */
  private async expireOverdueObligations(
    repo: Repository<WageringObligation>,
    userId?: string,
  ): Promise<void> {
    const qb = repo
      .createQueryBuilder()
      .update(WageringObligation)
      .set({ status: WageringObligationStatus.EXPIRED })
      .where(
        'status = :active AND "expiresAt" IS NOT NULL AND "expiresAt" <= :now',
        { active: WageringObligationStatus.ACTIVE, now: new Date() },
      );
    if (userId) {
      qb.andWhere('userId = :userId', { userId });
    }
    await qb.execute();
  }

  // ============================================================
  // WITHDRAWAL ENFORCEMENT (runs inside the locked withdrawal tx)
  // ============================================================

  /**
   * Called from WithdrawalsService.createWithdrawal inside its existing
   * pessimistic-lock transaction. When withdrawal enforcement is enabled and
   * any ACTIVE obligation has remaining wagering, throws
   * 403 WAGERING_REQUIREMENT_INCOMPLETE BEFORE any withdrawal row, lock or
   * ledger write — zero mutations on rejection.
   */
  async assertWithdrawalAllowed(
    userId: string,
    manager?: EntityManager,
  ): Promise<WageringCheckResult> {
    const settings = await this.getSettings(manager);
    if (!settings.wageringEnabled || !settings.withdrawalEnforcement) {
      return { allowed: true, remainingWagering: '0', obligationIds: [] };
    }

    const result = await this.getUserWageringSummary(userId, manager);
    if (result.totalRemaining.gt(0)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: WAGERING_WITHDRAWAL_BLOCKED_CODE,
        message: 'Wagering requirement incomplete before withdrawal',
        remainingWagering: fixed(result.totalRemaining),
        obligationIds: result.obligations
          .filter((o) => o.status === WageringObligationStatus.ACTIVE)
          .map((o) => o.id),
      });
    }
    return {
      allowed: true,
      remainingWagering: '0',
      obligationIds: [],
    };
  }

  // ============================================================
  // SUMMARIES (user + admin)
  // ============================================================

  async getUserWageringSummary(
    userId: string,
    manager?: EntityManager,
  ): Promise<{
    wageringEnabled: boolean;
    withdrawalEligible: boolean;
    applicableMultiplier: number;
    multiplierSource: 'USER_OVERRIDE' | 'GLOBAL_DEFAULT';
    totalRequired: Decimal;
    totalCompleted: Decimal;
    totalRemaining: Decimal;
    obligations: WageringObligation[];
    ruleExplanation: string;
  }> {
    const settings = await this.getSettings(manager);
    const effective = await this.resolveEffectiveMultiplier(userId);
    const repo = manager
      ? manager.getRepository(WageringObligation)
      : this.obligationRepo;
    // Expire-first: lapsed obligations must never block withdrawal enforcement
    // (assertWithdrawalAllowed routes through this summary) nor show as ACTIVE.
    // Inside a manager-provided transaction this is atomic with the caller's
    // locking; standalone it is an idempotent single-statement transition.
    await this.expireOverdueObligations(repo, userId);
    const obligations = await repo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    let totalRequired = new Decimal(0);
    let totalCompleted = new Decimal(0);
    for (const o of obligations) {
      // Expired obligations no longer impose wagering requirements — only
      // ACTIVE ones count toward the remaining amount.
      if (
        o.status === WageringObligationStatus.CANCELLED ||
        o.status === WageringObligationStatus.EXPIRED
      ) {
        continue;
      }
      totalRequired = totalRequired.plus(dec(o.requiredAmount));
      totalCompleted = totalCompleted.plus(dec(o.completedAmount));
    }
    const totalRemaining = Decimal.max(
      totalRequired.minus(totalCompleted),
      new Decimal(0),
    );

    const withdrawalEligible =
      !settings.wageringEnabled ||
      !settings.withdrawalEnforcement ||
      totalRemaining.lte(0);

    const ruleExplanation = !settings.wageringEnabled
      ? 'Wagering requirements are currently disabled.'
      : totalRequired.lte(0)
        ? 'No wagering obligations are attached to your account.'
        : effective.source === 'USER_OVERRIDE'
          ? `A custom ${effective.multiplier}X wagering requirement applies to your deposits. You must wager ${effective.multiplier}X the deposited TDX on eligible Lotto/Trade activity before withdrawing.`
          : `You must wager ${effective.multiplier}X the deposited TDX on eligible Lotto/Trade activity before withdrawing.`;

    return {
      wageringEnabled: settings.wageringEnabled,
      withdrawalEligible,
      applicableMultiplier: effective.multiplier,
      multiplierSource: effective.source,
      totalRequired,
      totalCompleted,
      totalRemaining,
      obligations,
      ruleExplanation,
    };
  }

  async getUserSummaryDto(userId: string) {
    const summary = await this.getUserWageringSummary(userId);
    return {
      wageringEnabled: summary.wageringEnabled,
      withdrawalEligible: summary.withdrawalEligible,
      applicableMultiplier: summary.applicableMultiplier,
      multiplierSource: summary.multiplierSource,
      totalRequired: fixed(summary.totalRequired),
      totalCompleted: fixed(summary.totalCompleted),
      totalRemaining: fixed(summary.totalRemaining),
      ruleExplanation: summary.ruleExplanation,
      obligations: summary.obligations.map((o) => this.toObligationDto(o)),
    };
  }

  toObligationDto(o: WageringObligation) {
    const remaining = Decimal.max(
      dec(o.requiredAmount).minus(dec(o.completedAmount)),
      new Decimal(0),
    );
    return {
      id: o.id,
      userId: o.userId,
      depositId: o.depositId,
      ledgerEntryId: o.ledgerEntryId,
      sourceUsdtAmount: o.sourceUsdtAmount,
      sourceTdxAmount: o.sourceTdxAmount,
      conversionRate: o.conversionRate,
      depositAmountTdx: o.depositAmountTdx,
      multiplier: o.multiplier,
      requiredAmount: o.requiredAmount,
      completedAmount: o.completedAmount,
      remainingAmount: fixed(remaining),
      status: o.status,
      policyVersion: o.policyVersion,
      eligibleActivity: o.eligibleActivity,
      expiresAt: o.expiresAt,
      cancelledReason: o.cancelledReason,
      createdAt: o.createdAt,
      completedAt: o.completedAt,
    };
  }

  // ============================================================
  // ADMIN OVERRIDES (mandatory reason + audit + notify; prospective)
  // ============================================================

  async setOverride(
    adminId: string,
    userId: string,
    multiplier: number,
    reason: string,
  ): Promise<WageringUserOverride> {
    const settings = await this.getSettings();
    if (!settings.allowedMultipliers.includes(multiplier)) {
      throw new NotFoundException(
        `Multiplier ${multiplier}X is not in the allowed list`,
      );
    }

    return this.overrideRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WageringUserOverride);
      const existing = await repo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      const previousValue = existing?.multiplier ?? null;

      const override =
        existing ?? repo.create({ userId, reason, appliedFrom: new Date() });
      override.multiplier = multiplier;
      override.previousValue = previousValue;
      override.reason = reason;
      override.adminId = adminId;
      override.appliedFrom = new Date();
      const saved = await repo.save(override);

      await this.writeAudit(manager, {
        adminId,
        action: 'WAGERING_OVERRIDE_SET',
        targetId: userId,
        oldValue: previousValue === null ? null : { multiplier: previousValue },
        newValue: { multiplier, reason, appliedFrom: override.appliedFrom },
        metadata: { kind: 'USER_OVERRIDE', prospective: true },
      });

      // NOTIFICATION POLICY (documented): security/fairness-related override
      // changes ALWAYS create an auditable in-app notification for the
      // affected user, regardless of settings.notifyUsers — the user must be
      // able to discover that a custom requirement applies to them.
      // Ordinary informational notifications (obligation created/completed)
      // respect settings.notifyUsers. Delivery is pull-based in-app only
      // (GET /wagering/me/notifications) — no email/push exists.
      await this.queueNotification(
        manager,
        userId,
        WageringNotificationKind.OVERRIDE_APPLIED,
        {
          previousValue,
          multiplier,
          reason,
          appliedFrom: override.appliedFrom,
        },
      );

      return saved;
    });
  }

  async removeOverride(
    adminId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.overrideRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WageringUserOverride);
      const existing = await repo.findOne({
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) {
        throw new NotFoundException('No wagering override exists for this user');
      }
      await repo.remove(existing);

      await this.writeAudit(manager, {
        adminId,
        action: 'WAGERING_OVERRIDE_REMOVE',
        targetId: userId,
        oldValue: { multiplier: existing.multiplier, reason: existing.reason },
        newValue: { multiplier: null, reason },
        metadata: { kind: 'USER_OVERRIDE', prospective: true },
      });

      // Security/fairness disclosure: override removal is always notified
      // (see NOTIFICATION POLICY in setOverride above).
      await this.queueNotification(
        manager,
        userId,
        WageringNotificationKind.OVERRIDE_APPLIED,
        { previousValue: existing.multiplier, multiplier: null, reason },
      );
    });
  }

  async getOverride(userId: string): Promise<WageringUserOverride | null> {
    return this.overrideRepo.findOne({ where: { userId } });
  }

  /**
   * Resolves the credited DEPOSIT ledger entry for a deposit (ledger remains
   * the source of truth). Used by the deposit-credit hook before creating an
   * obligation.
   */
  async findDepositLedgerEntry(depositId: string): Promise<{ id: string } | null> {
    return this.ledgerRepo.findOne({
      where: {
        referenceId: depositId,
        referenceType: 'deposit',
        type: LedgerType.DEPOSIT,
      },
      select: { id: true },
    });
  }

  async cancelObligation(
    adminId: string,
    obligationId: string,
    reason: string,
  ): Promise<WageringObligation> {
    return this.obligationRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WageringObligation);
      const obligation = await repo.findOne({
        where: { id: obligationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!obligation) {
        throw new NotFoundException('Wagering obligation not found');
      }
      if (obligation.status !== WageringObligationStatus.ACTIVE) {
        throw new NotFoundException(
          `Obligation is not ACTIVE (current: ${obligation.status})`,
        );
      }
      obligation.status = WageringObligationStatus.CANCELLED;
      obligation.cancelledReason = reason;
      const saved = await repo.save(obligation);

      await this.writeAudit(manager, {
        adminId,
        action: 'WAGERING_OBLIGATION_CANCEL',
        targetId: obligationId,
        oldValue: { status: WageringObligationStatus.ACTIVE },
        newValue: { status: WageringObligationStatus.CANCELLED, reason },
        metadata: { userId: obligation.userId },
      });
      return saved;
    });
  }

  async listObligations(query: {
    userId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: WageringObligation[]; total: number }> {
    const qb = this.obligationRepo.createQueryBuilder('o');
    if (query.userId) qb.andWhere('o.userId = :userId', { userId: query.userId });
    if (query.status) {
      qb.andWhere('o.status = :status', { status: query.status });
    }
    qb.orderBy('o.createdAt', 'DESC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 20);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  // ============================================================
  // AUDIT + NOTIFICATIONS HELPERS
  // ============================================================

  private async writeAudit(
    manager: EntityManager,
    data: {
      adminId: string;
      action: string;
      targetId: string;
      oldValue: Record<string, unknown> | null;
      newValue: Record<string, unknown> | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await manager.getRepository(AdminAuditLog).save(
      manager.getRepository(AdminAuditLog).create({
        adminId: data.adminId,
        action: data.action,
        targetType: 'WAGERING',
        targetId: data.targetId,
        oldValue: data.oldValue,
        newValue: data.newValue,
        metadata: data.metadata ?? {},
      }),
    );
  }

  private async queueNotification(
    manager: EntityManager,
    userId: string,
    kind: WageringNotificationKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await manager.getRepository(WageringNotification).save(
      manager
        .getRepository(WageringNotification)
        .create({ userId, kind, payload }),
    );
  }

  async listUserNotifications(
    userId: string,
  ): Promise<WageringNotification[]> {
    return this.notificationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async markNotificationsRead(userId: string): Promise<void> {
    await this.notificationRepo.update(
      { userId, readAt: null } as never,
      { readAt: new Date() },
    );
  }

  async listAudit(query: {
    userId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AdminAuditLog[]; total: number }> {
    const qb = this.auditRepo
      .createQueryBuilder('a')
      .where("a.targetType = 'WAGERING'");
    if (query.action) {
      qb.andWhere('a.action = :action', { action: query.action });
    }
    if (query.userId) {
      qb.andWhere(
        '(a."targetId" = :userId OR a.metadata->>\'userId\' = :userId)',
        { userId: query.userId },
      );
    }
    qb.orderBy('a.createdAt', 'DESC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 50);
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  // ============================================================
  // RECONCILIATION (missed deposit obligations — ledger-sourced repair)
  // ============================================================

  /**
   * Repairs missed deposit obligations using existing records only:
   * deposits.status = COMPLETED, a credited DEPOSIT ledger entry exists
   * (referenceType='deposit', referenceId=deposit.id), creditedAt >=
   * activationTimestamp, and no wagering_obligations row for the deposit.
   * Idempotent by UNIQUE(depositId). Never blocks or fails on individual rows.
   */
  async reconcileDepositObligations(
    adminId: string | null,
  ): Promise<{ scanned: number; created: number; skipped: number }> {
    const settings = await this.getSettings();
    if (!settings.wageringEnabled || !settings.activationTimestamp) {
      return { scanned: 0, created: 0, skipped: 0 };
    }

    const ageCutoffDays = settings.reconciliationMaxAgeDays;
    let created = 0;
    let scanned = 0;
    let skipped = 0;

    // Keyset pagination over recent completed deposits since activation.
    const candidates = await this.depositRepo
      .createQueryBuilder('d')
      .where('d.status = :status', { status: DepositStatus.COMPLETED })
      .andWhere('d.creditedAt >= :since', { since: settings.activationTimestamp })
      .andWhere(
        ageCutoffDays > 0
          ? 'd.creditedAt >= :cutoff'
          : 'd.creditedAt >= :cutoff0',
        ageCutoffDays > 0
          ? {
              since: settings.activationTimestamp,
              cutoff: new Date(Date.now() - ageCutoffDays * 86_400_000),
            }
          : {
              since: settings.activationTimestamp,
              cutoff0: new Date(0),
            },
      )
      .orderBy('d.creditedAt', 'DESC')
      .take(500)
      .getMany();

    for (const deposit of candidates) {
      scanned += 1;
      try {
        const hasObligation = await this.obligationRepo.findOne({
          where: { depositId: deposit.id },
          select: { id: true },
        });
        if (hasObligation) continue;

        const creditedEntry = await this.ledgerRepo.findOne({
          where: {
            referenceId: deposit.id,
            referenceType: 'deposit',
            type: LedgerType.DEPOSIT,
          },
          select: { id: true },
        });
        if (!creditedEntry) {
          skipped += 1;
          continue;
        }

        const createdOk = await this.createObligationForDeposit(
          deposit,
          creditedEntry.id,
        );
        if (createdOk) created += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `Reconciliation skipped deposit ${deposit.id}: ${String(error)}`,
        );
      }
    }

    // One auditable run record per sweep.
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          adminId: adminId ?? '00000000-0000-0000-0000-000000000000',
          action: 'WAGERING_RECONCILE_RUN',
          targetType: 'WAGERING',
          targetId: 'RECONCILIATION',
          oldValue: null,
          newValue: { scanned, created, skipped },
          metadata: { automated: adminId === null },
        }),
      );
    } catch (error) {
      this.logger.warn(`Reconciliation audit write failed: ${String(error)}`);
    }

    return { scanned, created, skipped };
  }

  // ============================================================
  // RECONCILIATION (missed settlement wagering events — ledger repair)
  // ============================================================

  /**
   * Safety window: entries younger than this are considered potentially
   * in-flight (their settlement transaction may still be committing, or the
   * post-commit hook may simply not have run yet) and are never replayed
   * here — the real-time hook owns them.
   */
  static readonly EVENT_RECONCILE_SAFETY_WINDOW_MS = 10 * 60 * 1000;
  static readonly EVENT_RECONCILE_BATCH = 200;

  /**
   * Repairs missed settlement wagering volume using the ledger as the
   * recovery source of truth. For every settled GAME_ENTRY
   * (referenceType='LOTTO_TICKET') and TRADE_ENTRY (referenceType='pulse_trade')
   * that has NO wagering_events row yet, reconstructs the exact same
   * fee-excluded stake the real-time hooks use and replays it through
   * recordWageredVolume (idempotent by UNIQUE(sourceType, sourceId, legIndex)).
   *
   * Excludes cancelled/refunded/reversed/failed activity via the settlement
   * status guards, never credits balances, never writes ledger rows, and
   * records every run through admin_audit_logs. Bounded batches with
   * deterministic ordering; the safety window keeps in-flight settlements
   * out of scope.
   */
  async reconcileWageringEvents(
    adminId: string | null,
  ): Promise<{ scanned: number; counted: number; skipped: number }> {
    const settings = await this.getSettings();
    if (!settings.wageringEnabled) {
      return { scanned: 0, counted: 0, skipped: 0 };
    }

    const safetyCutoff = new Date(
      Date.now() - WageringService.EVENT_RECONCILE_SAFETY_WINDOW_MS,
    );
    const ageCutoffDays = settings.reconciliationMaxAgeDays;
    const maxAge = new Date(Date.now() - ageCutoffDays * 86_400_000);

    let scanned = 0;
    let counted = 0;
    let skipped = 0;

    // Deterministic ordering (createdAt ASC, id ASC) + bounded batches.
    const candidates = await this.ledgerRepo
      .createQueryBuilder('l')
      .where('l.type IN (:...types)', {
        types: [LedgerType.GAME_ENTRY, LedgerType.TRADE_ENTRY],
      })
      .andWhere(
        "(l.\"referenceType\" = 'LOTTO_TICKET' OR l.\"referenceType\" = 'pulse_trade')",
      )
      .andWhere('l."createdAt" < :safetyCutoff', { safetyCutoff })
      .andWhere('l."createdAt" >= :maxAge', { maxAge })
      .orderBy('l."createdAt"', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .take(WageringService.EVENT_RECONCILE_BATCH)
      .getMany();

    for (const entry of candidates) {
      scanned += 1;
      try {
        const sourceType =
          entry.referenceType === 'LOTTO_TICKET'
            ? LOTTO_SOURCE_TYPE
            : TRADE_SOURCE_TYPE;

        // Idempotency pre-check: skip anything that already has event legs.
        const hasEvents = await this.eventRepo.findOne({
          where: { sourceType, sourceId: String(entry.referenceId) },
          select: { id: true },
        });
        if (hasEvents) continue;

        const reconstruction = await this.reconstructSettledStake(entry);
        if (!reconstruction) {
          skipped += 1;
          continue;
        }

        const result = await this.recordWageredVolume({
          userId: reconstruction.userId,
          activityType: reconstruction.activityType,
          sourceType,
          sourceId: String(entry.referenceId),
          amount: reconstruction.amount,
          ledgerType: entry.type,
          settlementOutcome: 'SETTLED',
        });
        if (result.status === 'COUNTED' || result.status === 'NO_OBLIGATIONS') {
          // Both outcomes persist an auditable event/decision row; the volume
          // is no longer "missed" (surplus rows keep NO_OBLIGATION auditable).
          counted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `Event reconciliation skipped ledger entry ${entry.id}: ${String(error)}`,
        );
      }
    }

    await this.writeEventReconcileAudit(adminId, { scanned, counted, skipped });
    return { scanned, counted, skipped };
  }

  private async writeEventReconcileAudit(
    adminId: string | null,
    counts: { scanned: number; counted: number; skipped: number },
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          adminId: adminId ?? '00000000-0000-0000-0000-000000000000',
          action: 'WAGERING_EVENT_RECONCILE_RUN',
          targetType: 'WAGERING',
          targetId: 'EVENT_RECONCILIATION',
          oldValue: null,
          newValue: counts,
          metadata: { automated: adminId === null },
        }),
      );
    } catch (error) {
      this.logger.warn(`Event reconciliation audit write failed: ${String(error)}`);
    }
  }

  /**
   * Rebuilds the exact fee-excluded stake of a settled wagering source from
   * the ledger evidence. Returns null when the source is not settled
   * (CANCELLED/REFUNDED/in-flight) — never counted. Exact Decimal arithmetic
   * only; the same fee rules as the real-time settlement hooks apply.
   */
  private async reconstructSettledStake(
    entry: LedgerEntry,
  ): Promise<{
    userId: string;
    activityType: WageringActivityType;
    amount: string;
  } | null> {
    if (entry.type === LedgerType.GAME_ENTRY) {
      // Lotto: the settled ticket's netAmount (already fee-excluded) is the
      // stake. Settled outcomes only: WIN/LOSS/SETTLED count; ACTIVE/CUTOFF
      // are in-flight; REFUNDED/CANCELLED never count.
      const ticket = await this.lottoTicketRepo.findOne({
        where: { id: Number(entry.referenceId) },
        select: { id: true, userId: true, status: true, netAmount: true },
      });
      if (!ticket) return null;
      const settledStatuses: string[] = ['WIN', 'LOSS', 'SETTLED'];
      if (!settledStatuses.includes(String(ticket.status))) return null;
      return {
        userId: ticket.userId,
        activityType: WageringActivityType.LOTTO,
        amount: dec(ticket.netAmount).toFixed(DECIMAL_PLACES),
      };
    }

    // Pulse trade: TRADE_ENTRY leg minus TRADE_FEE_ALLOCATION fee legs, and
    // only SETTLED trades with a WIN/LOSS result (DRAW is refund-like).
    const trade = await this.tradeRepo.findOne({
      where: { id: String(entry.referenceId) },
      select: { id: true, userId: true, status: true, result: true },
    });
    if (!trade) return null;
    if (
      trade.status !== 'SETTLED' ||
      (trade.result !== 'WIN' && trade.result !== 'LOSS')
    ) {
      return null;
    }
    const feeLegs = await this.ledgerRepo.find({
      where: {
        referenceId: trade.id,
        type: LedgerType.TRADE_FEE,
        referenceType: 'TRADE_FEE_ALLOCATION',
      },
      select: { amount: true },
    });
    return {
      userId: trade.userId,
      activityType: WageringActivityType.TRADE,
      amount: netStakeAfterFees(
        entry.amount,
        feeLegs.map((leg) => leg.amount),
      ),
    };
  }
}
