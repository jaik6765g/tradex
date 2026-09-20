// src/wagering/wallet-source-allocation.ts
// ============================================================
// FIFO SOURCE-ATTRIBUTION PLANNER (pure, deterministic, testable)
// ============================================================
//
// Decides HOW a requested withdrawal amount is drawn from a user's
// attributed funding buckets, and — crucially — WHICH bucket amounts are
// currently eligible for withdrawal.
//
// Eligibility rule (business policy):
//   - NON-WAGERABLE bucket  → always eligible (referral commission, salary,
//                              legacy/other). These are withdrawable even
//                              while a deposit obligation is still active.
//   - WAGERABLE bucket      → eligible ONLY once its linked wagering
//                              obligation is satisfied (COMPLETED /
//                              CANCELLED / EXPIRED) or no obligation exists.
//
// Consumption is strictly FIFO — ordered by (createdAt, id) — so the same
// source amount can never be allocated twice and the outcome is
// reproducible across retries.
//
// This module performs NO I/O and uses Decimal.js only (never Number /
// parseFloat) for money.
// ============================================================

import Decimal from 'decimal.js';

export interface AllocationBucket {
  /** wallet_source_allocations.id */
  id: string;
  /** DEPOSIT | BONUS | REFERRAL_COMMISSION | SALARY | LEGACY | OTHER */
  sourceType: string;
  /** Classification snapshot recorded at credit time. */
  wagerable: boolean;
  /** FIFO ordering key. */
  createdAt: Date | string;
  /** originalAmount - consumedAmount - reservedAmount (exact decimal string). */
  availableAmount: string;
  /**
   * For wagerable buckets: true when the linked obligation is satisfied
   * (or none exists). Ignored for non-wagerable buckets.
   */
  wageSatisfied: boolean;
}

export interface AllocationLeg {
  bucketId: string;
  sourceType: string;
  wagerable: boolean;
  amount: Decimal;
}

export interface AllocationPlan {
  /** FIFO legs that together cover `requested` (or as much as possible). */
  legs: AllocationLeg[];
  /** Total eligible-to-withdraw amount across all buckets. */
  withdrawableAmount: Decimal;
  /** Wagerable amount present but still wagering-locked. */
  blockedWagerableAmount: Decimal;
  /** requestAmount - withdrawableAmount, clamped at 0. */
  shortage: Decimal;
  /** True when the requested amount can be fully attributed. */
  fullyFunded: boolean;
}

const D = (value: string | number | Decimal | null | undefined): Decimal => {
  try {
    return new Decimal(String(value ?? '0'));
  } catch {
    return new Decimal(0);
  }
};

/** Deterministic FIFO comparator: createdAt ASC, then id ASC. */
export function compareBucketsFifo(
  a: AllocationBucket,
  b: AllocationBucket,
): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  const aSafe = Number.isFinite(at) ? at : 0;
  const bSafe = Number.isFinite(bt) ? bt : 0;
  if (aSafe !== bSafe) return aSafe - bSafe;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * A bucket is withdrawable when it carries no wagering obligation, or the
 * obligation it carries is already satisfied.
 */
export function isBucketWithdrawable(bucket: AllocationBucket): boolean {
  if (!bucket.wagerable) return true;
  return bucket.wageSatisfied === true;
}

/** Exact available amount, clamped at zero and invalid input rejected. */
export function bucketAvailable(bucket: AllocationBucket): Decimal {
  const available = D(bucket.availableAmount);
  if (!available.isFinite() || available.lte(0)) return new Decimal(0);
  return available;
}

/**
 * Plans the FIFO allocation of `requested` across `buckets`.
 *
 * Buckets are never mutated; callers persist the resulting legs.
 */
export function planAllocations(
  buckets: readonly AllocationBucket[],
  requested: string | number | Decimal,
): AllocationPlan {
  const wantedRaw = D(requested);
  const requestedAmount =
    wantedRaw.isFinite() && wantedRaw.gt(0) ? wantedRaw : new Decimal(0);

  const ordered = [...buckets].sort(compareBucketsFifo);

  let withdrawableAmount = new Decimal(0);
  let blockedWagerableAmount = new Decimal(0);

  for (const bucket of ordered) {
    const available = bucketAvailable(bucket);
    if (available.lte(0)) continue;
    if (isBucketWithdrawable(bucket)) {
      withdrawableAmount = withdrawableAmount.plus(available);
    } else if (bucket.wagerable) {
      blockedWagerableAmount = blockedWagerableAmount.plus(available);
    }
  }

  const legs: AllocationLeg[] = [];
  let remaining = requestedAmount;

  for (const bucket of ordered) {
    if (remaining.lte(0)) break;
    if (!isBucketWithdrawable(bucket)) continue;

    const available = bucketAvailable(bucket);
    if (available.lte(0)) continue;

    const take = Decimal.min(available, remaining);
    legs.push({
      bucketId: bucket.id,
      sourceType: bucket.sourceType,
      wagerable: bucket.wagerable,
      amount: take,
    });
    remaining = remaining.minus(take);
  }

  const shortage = Decimal.max(remaining, new Decimal(0));

  return {
    legs,
    withdrawableAmount,
    blockedWagerableAmount,
    shortage,
    fullyFunded: shortage.lte(0),
    // Note: requestedAmount === 0 → shortage 0 → fullyFunded true (no-op).
  };
}
