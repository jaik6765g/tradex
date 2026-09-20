// src/wagering/wallet-source.service.ts
// ============================================================
// WALLET SOURCE ATTRIBUTION SERVICE
// ============================================================
//
// Owns the ONLY extra layer needed for source-aware withdrawal enforcement.
// It never holds or moves spendable money — `balances.available_balance`
// remains the single spendable figure, mutated exclusively by the existing
// withdrawal / balance services.
//
// Responsibilities:
//   1. recordCredit()       — attribute a credit (same tx as balance credit)
//   2. getWithdrawablePlan()— which funds are withdrawable, FIFO, exact
//   3. reserveFifo()        — reserve bucket capacity for a withdrawal
//   4. commitReservation()  — reserved -> consumed (payout succeeded)
//   5. releaseReservation() — reserved -> available (reject/fail/cancel)
//
// All money uses Decimal.js; every amount is persisted as an 18dp string.
// ============================================================

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Balance } from '../balances/balance.entity';
import {
  AllocationBucket,
  AllocationPlan,
  planAllocations,
} from './wallet-source-allocation';
import {
  WalletSourceAllocation,
  WalletSourceAllocationStatus,
} from './entities/wallet-source-allocation.entity';
import {
  WageringObligation,
  WageringObligationStatus,
} from './entities/wagering-obligation.entity';
import {
  FUND_SOURCE_TYPE,
  isWagerableSourceType,
  normalizeFundSourceType,
} from './wagering-source';

const D = (value: string | number | Decimal | null | undefined): Decimal => {
  try {
    return new Decimal(String(value ?? '0'));
  } catch {
    // Never let a malformed value crash a financial code path; callers that
    // require a positive amount validate it explicitly.
    return new Decimal(0);
  }
};
const fixed = (value: Decimal): string => value.toFixed(18);

/** Obligation statuses that release a wagerable bucket for withdrawal. */
const SATISFIED_OBLIGATION_STATUSES: readonly string[] = [
  WageringObligationStatus.COMPLETED,
  WageringObligationStatus.CANCELLED,
  WageringObligationStatus.EXPIRED,
];

export interface RecordCreditInput {
  manager: EntityManager;
  userId: string;
  sourceType: string;
  /**
   * Stable identity of this credit.
   *  - wagerable sources → the wagering obligation's sourceReference
   *                        (deposit.id for deposits, bonus reference for bonus)
   *  - non-wagerable     → the credit ledger entry id
   * UNIQUE — replaying a credit can never create a second bucket.
   */
  sourceId: string;
  ledgerEntryId?: string | null;
  amountTdx: string | Decimal;
  metadata?: Record<string, unknown>;
}

export interface WithdrawablePlanResult {
  plan: AllocationPlan;
  /** Σ available across ACTIVE buckets (attributed funds only). */
  attributedAvailable: Decimal;
  /** balances.available_balance − attributedAvailable (>= 0). */
  unattributedBalance: Decimal;
  bucketCount: number;
}

@Injectable()
export class WalletSourceService {
  private readonly logger = new Logger(WalletSourceService.name);

  constructor(
    @InjectRepository(WalletSourceAllocation)
    private readonly allocationRepo: Repository<WalletSourceAllocation>,
    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // 1. ATTRIBUTE A CREDIT (caller supplies the transaction)
  // ============================================================

  /**
   * Creates the attribution bucket for one credit. Idempotent by sourceId.
   * Returns the created (or pre-existing) bucket, or null when the amount is
   * not a positive finite value.
   */
  async recordCredit(
    input: RecordCreditInput,
  ): Promise<WalletSourceAllocation | null> {
    const amount = D(input.amountTdx);
    // FAIL CLOSED: a credit must never be silently left unattributed, because
    // unattributed funds cannot be evaluated for withdrawal eligibility.
    // Throwing rolls back the enclosing credit transaction.
    if (!amount.isFinite() || amount.lte(0)) {
      throw new ConflictException(
        `Invalid wallet source credit amount: ${String(input.amountTdx)}`,
      );
    }

    const sourceType = normalizeFundSourceType(input.sourceType);
    const repo = input.manager.getRepository(WalletSourceAllocation);

    const existing = await repo.findOne({ where: { sourceId: input.sourceId } });
    if (existing) return existing;

    const bucket = repo.create({
      userId: input.userId,
      sourceType,
      sourceId: input.sourceId,
      ledgerEntryId: input.ledgerEntryId ?? null,
      wagerable: isWagerableSourceType(sourceType),
      originalAmount: fixed(amount),
      consumedAmount: fixed(D(0)),
      reservedAmount: fixed(D(0)),
      status: WalletSourceAllocationStatus.ACTIVE,
      metadata: input.metadata ?? {},
    });

    return repo.save(bucket);
  }

  // ============================================================
  // 1b. LEGACY / UNATTRIBUTED BALANCE
  // ============================================================

  /**
   * Lazily attributes any authoritative balance that has no source bucket yet
   * to ONE synthetic non-wagerable LEGACY bucket.
   *
   * Why: balances may predate the source-attribution layer (or come from a
   * manual DB operation). Without this, those funds would be invisible to the
   * eligibility planner and a legitimate withdrawal would fail closed.
   *
   * Safety:
   *  - LEGACY is NON-wagerable, so it can never weaken wagering enforcement
   *    for genuinely wagerable funds (deposits/bonuses always carry a bucket).
   *  - A single bucket per user (sourceId `legacy:<userId>`, UNIQUE) makes the
   *    operation idempotent; replay can never create a second bucket.
   *  - Only the unattributed remainder is ever added; consumed/reserved
   *    amounts are preserved and never lowered.
   *  - Reconciliation still detects over-attribution (balance < attributed).
   */
  async ensureLegacyAttribution(
    userId: string,
    availableBalance: string | Decimal | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    const balance = D(availableBalance);
    if (!balance.isFinite() || balance.lte(0)) return;

    const repo = manager.getRepository(WalletSourceAllocation);
    const rows = await repo.find({ where: { userId } });

    let attributed = new Decimal(0);
    let legacyBucket: WalletSourceAllocation | null = null;
    const legacySourceId = `legacy:${userId}`;

    for (const row of rows) {
      if (row.status === WalletSourceAllocationStatus.VOID) continue;
      attributed = attributed
        .plus(D(row.originalAmount))
        .minus(D(row.consumedAmount))
        .minus(D(row.reservedAmount));
      if (row.sourceId === legacySourceId) legacyBucket = row;
    }

    const remainder = balance.minus(attributed);
    if (remainder.lte(0)) return;

    if (legacyBucket) {
      // Grow the synthetic bucket by exactly the new unattributed remainder.
      // `remainder` = balance - attributed, so adding it to the legacy
      // bucket's originalAmount makes total attribution equal the balance.
      // Consumed/reserved capacity is never shrunk.
      const target = D(legacyBucket.originalAmount).plus(remainder);
      if (target.gt(D(legacyBucket.originalAmount))) {
        legacyBucket.originalAmount = fixed(target);
        legacyBucket.status = WalletSourceAllocationStatus.ACTIVE;
        await repo.save(legacyBucket);
      }
      return;
    }

    await repo.save(
      repo.create({
        userId,
        sourceType: FUND_SOURCE_TYPE.LEGACY,
        sourceId: legacySourceId,
        ledgerEntryId: null,
        wagerable: false,
        originalAmount: fixed(remainder),
        consumedAmount: fixed(D(0)),
        reservedAmount: fixed(D(0)),
        status: WalletSourceAllocationStatus.ACTIVE,
        metadata: {
          synthetic: true,
          reason: 'unattributed pre-attribution balance',
          attributedAt: new Date().toISOString(),
        },
      }),
    );
  }

  // ============================================================
  // 2. WITHDRAWABLE PLAN (source-aware eligibility)
  // ============================================================

  /**
   * Builds the deterministic FIFO withdrawal plan for `requestedAmount`.
   *
   * Wagerable buckets whose obligation is still ACTIVE are excluded (and
   * reported separately); non-wagerable buckets (referral commission,
   * salary, legacy/other) are always eligible.
   */
  async getWithdrawablePlan(
    userId: string,
    requestedAmount: string | Decimal,
    manager?: EntityManager,
    currentAvailableBalance?: string | null,
  ): Promise<WithdrawablePlanResult> {
    const em = manager ?? this.dataSource.manager;
    const allocationRepo = em.getRepository(WalletSourceAllocation);
    const obligationRepo = em.getRepository(WageringObligation);

    // Deterministic FIFO lock so a concurrent reservation cannot double-spend
    // the same bucket capacity.
    const buckets = await allocationRepo
      .createQueryBuilder('b')
      .where('b.userId = :userId AND b.status = :status', {
        userId,
        status: WalletSourceAllocationStatus.ACTIVE,
      })
      .orderBy('b.createdAt', 'ASC')
      .addOrderBy('b.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    const obligations = await obligationRepo
      .createQueryBuilder('o')
      .where('o.userId = :userId', { userId })
      .getMany();

    const satisfiedKeys = new Set<string>();
    const obligationKeys = new Set<string>();
    for (const obligation of obligations) {
      const key = `${obligation.sourceType}::${obligation.sourceReference}`;
      obligationKeys.add(key);
      if (SATISFIED_OBLIGATION_STATUSES.includes(String(obligation.status))) {
        satisfiedKeys.add(key);
      }
    }

    const views: AllocationBucket[] = buckets
      .map((bucket) => {
        const key = `${bucket.sourceType}::${bucket.sourceId}`;
        // A wagerable bucket with no obligation at all (e.g. wagering was
        // disabled when it was credited) is treated as satisfied.
        const wageSatisfied =
          !bucket.wagerable ||
          satisfiedKeys.has(key) ||
          !obligationKeys.has(key);
        return {
          id: bucket.id,
          sourceType: bucket.sourceType,
          wagerable: Boolean(bucket.wagerable),
          createdAt: bucket.createdAt,
          availableAmount: fixed(
            D(bucket.originalAmount)
              .minus(D(bucket.consumedAmount))
              .minus(D(bucket.reservedAmount)),
          ),
          wageSatisfied,
        };
      })
      .filter((view) => D(view.availableAmount).gt(0));

    const plan = planAllocations(views, requestedAmount);

    const attributedAvailable = views.reduce(
      (sum, view) => sum.plus(D(view.availableAmount)),
      new Decimal(0),
    );

    const balance =
      currentAvailableBalance === undefined || currentAvailableBalance === null
        ? null
        : D(currentAvailableBalance);
    const unattributedBalance =
      balance === null || !balance.isFinite()
        ? new Decimal(0)
        : Decimal.max(balance.minus(attributedAvailable), new Decimal(0));

    return {
      plan,
      attributedAvailable,
      unattributedBalance,
      bucketCount: views.length,
    };
  }

  // ============================================================
  // 3. RESERVE (FIFO, exact)
  // ============================================================

  /**
   * Reserves bucket capacity for `amount`. Throws when the source-aware
   * eligibility cannot fund it (defence in depth — the caller has already
   * asserted eligibility). Returns the persisted legs for commit/release.
   */
  async reserveFifo(
    userId: string,
    amount: string | Decimal,
    manager: EntityManager,
  ): Promise<Array<{ bucketId: string; sourceType: string; amount: string }>> {
    const planResult = await this.getWithdrawablePlan(userId, amount, manager);

    if (!planResult.plan.fullyFunded) {
      throw new Error(
        `Source-attribution reserve failed: requested ${D(amount).toFixed(18)} ` +
          `exceeds withdrawable ${planResult.plan.withdrawableAmount.toFixed(18)}`,
      );
    }

    const repo = manager.getRepository(WalletSourceAllocation);
    const legs: Array<{ bucketId: string; sourceType: string; amount: string }> =
      [];

    for (const leg of planResult.plan.legs) {
      const bucket = await repo.findOne({ where: { id: leg.bucketId } });
      if (!bucket) {
        throw new Error(`Attribution bucket ${leg.bucketId} disappeared`);
      }

      const reserved = D(bucket.reservedAmount).plus(leg.amount);
      const consumed = D(bucket.consumedAmount);
      const original = D(bucket.originalAmount);
      if (reserved.plus(consumed).gt(original)) {
        throw new Error(
          `Attribution bucket ${leg.bucketId} over-reserved ` +
            `(consumed ${consumed.toFixed(18)} + reserved ${reserved.toFixed(18)} ` +
            `> original ${original.toFixed(18)})`,
        );
      }

      bucket.reservedAmount = fixed(reserved);
      bucket.status = reserved.plus(consumed).gte(original)
        ? WalletSourceAllocationStatus.EXHAUSTED
        : WalletSourceAllocationStatus.ACTIVE;
      await repo.save(bucket);

      legs.push({
        bucketId: leg.bucketId,
        sourceType: leg.sourceType,
        amount: fixed(leg.amount),
      });
    }

    return legs;
  }

  // ============================================================
  // 4. COMMIT / RELEASE
  // ============================================================

  /**
   * reserved -> consumed. Called once the payout is irreversible.
   * Idempotent and saturating — never goes negative on replay.
   */
  async commitReservation(
    legs: readonly { bucketId: string; amount: string }[],
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(WalletSourceAllocation);

    for (const leg of legs ?? []) {
      const bucket = await repo.findOne({ where: { id: leg.bucketId } });
      if (!bucket) continue;

      const amount = D(leg.amount);
      const reserved = D(bucket.reservedAmount);
      const actual = Decimal.min(reserved, amount);
      if (actual.lte(0)) continue;

      bucket.reservedAmount = fixed(reserved.minus(actual));
      bucket.consumedAmount = fixed(D(bucket.consumedAmount).plus(actual));
      bucket.status = D(bucket.consumedAmount)
        .plus(D(bucket.reservedAmount))
        .gte(D(bucket.originalAmount))
        ? WalletSourceAllocationStatus.EXHAUSTED
        : WalletSourceAllocationStatus.ACTIVE;
      await repo.save(bucket);
    }
  }

  /**
   * reserved -> available. Called on rejection / failure / cancellation /
   * payout reversal. Idempotent — a bucket with no reservation is untouched.
   */
  async releaseReservation(
    legs: readonly { bucketId: string; amount: string }[],
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(WalletSourceAllocation);

    for (const leg of legs ?? []) {
      const bucket = await repo.findOne({ where: { id: leg.bucketId } });
      if (!bucket) continue;

      const amount = D(leg.amount);
      const reserved = D(bucket.reservedAmount);
      const actual = Decimal.min(reserved, amount);
      if (actual.lte(0)) continue;

      bucket.reservedAmount = fixed(reserved.minus(actual));
      bucket.status = WalletSourceAllocationStatus.ACTIVE;
      await repo.save(bucket);
    }
  }

  // ============================================================
  // 5. RECONCILIATION (detect only — never silently rewrites)
  // ============================================================

  /**
   * Compares attributed capacity against the authoritative balance for one
   * user. Returns a mismatch report; the caller decides what to do. Never
   * mutates money.
   */
  async detectAttributionMismatch(
    userId: string,
    availableBalance: string,
    manager?: EntityManager,
  ): Promise<{
    attributedAvailable: string;
    attributedConsumed: string;
    balanceAvailable: string;
    unattributedRemainder: string;
    overAttributed: boolean;
    mismatch: boolean;
  }> {
    const em = manager ?? this.dataSource.manager;
    const rows = await em.getRepository(WalletSourceAllocation).find({
      where: { userId },
    });

    let attributedAvailable = new Decimal(0);
    let attributedConsumed = new Decimal(0);
    for (const row of rows) {
      if (row.status === WalletSourceAllocationStatus.VOID) continue;
      attributedAvailable = attributedAvailable
        .plus(D(row.originalAmount))
        .minus(D(row.consumedAmount))
        .minus(D(row.reservedAmount));
      attributedConsumed = attributedConsumed.plus(D(row.consumedAmount));
    }
    if (attributedAvailable.lt(0)) attributedAvailable = new Decimal(0);

    const balance = D(availableBalance);
    const unattributedRemainder = Decimal.max(
      balance.minus(attributedAvailable),
      new Decimal(0),
    );
    const overAttributed = attributedAvailable.gt(balance);

    return {
      attributedAvailable: fixed(attributedAvailable),
      attributedConsumed: fixed(attributedConsumed),
      balanceAvailable: fixed(balance),
      unattributedRemainder: fixed(unattributedRemainder),
      overAttributed,
      mismatch: overAttributed,
    };
  }

  /**
   * Bounded sweep that detects attribution mismatches across users. Detection
   * ONLY — it never mutates balances, buckets or ledger rows, so it is safe to
   * run on a schedule. Returns the users whose attributed capacity exceeds
   * their authoritative available balance (over-attribution) for audit.
   */
  async reconcileAttribution(
    limit = 200,
    manager?: EntityManager,
  ): Promise<{
    scanned: number;
    mismatched: number;
    overAttributedUsers: string[];
  }> {
    const em = manager ?? this.dataSource.manager;
    const allocationRepo = em.getRepository(WalletSourceAllocation);
    const balanceRepo = em.getRepository(Balance);

    const userRows = await allocationRepo
      .createQueryBuilder('a')
      .select('DISTINCT a.userId', 'userId')
      .limit(limit)
      .getRawMany<{ userId: string }>();

    const overAttributedUsers: string[] = [];
    let scanned = 0;

    for (const row of userRows ?? []) {
      const userId = row?.userId;
      if (!userId) continue;
      scanned += 1;

      const balance = await balanceRepo.findOne({ where: { userId } });
      if (!balance) continue;

      const report = await this.detectAttributionMismatch(
        userId,
        balance.availableBalance,
        em,
      );
      if (report.mismatch) {
        overAttributedUsers.push(userId);
        this.logger.warn(
          `Attribution mismatch for user ${userId}: attributed ` +
            `${report.attributedAvailable} > balance ${report.balanceAvailable}`,
        );
      }
    }

    return {
      scanned,
      mismatched: overAttributedUsers.length,
      overAttributedUsers,
    };
  }

  /**
   * Void a bucket (refund/reversal repair). Financial history is preserved —
   * the row is never deleted.
   */
  async voidBucket(
    bucketId: string,
    reason: string,
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(WalletSourceAllocation);
    const bucket = await repo.findOne({ where: { id: bucketId } });
    if (!bucket) return;

    bucket.status = WalletSourceAllocationStatus.VOID;
    bucket.metadata = {
      ...(bucket.metadata ?? {}),
      voidedReason: reason,
      voidedAt: new Date().toISOString(),
    };
    await repo.save(bucket);
    this.logger.warn(`Voided attribution bucket ${bucketId}: ${reason}`);
  }
}