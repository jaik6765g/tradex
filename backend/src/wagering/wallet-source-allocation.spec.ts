import Decimal from 'decimal.js';

import {
  AllocationBucket,
  compareBucketsFifo,
  isBucketWithdrawable,
  planAllocations,
} from './wallet-source-allocation';

/**
 * Phase B / E4 / E5 / E6 / E17 — deterministic FIFO source-aware planning.
 *
 * Pure functions: no I/O, Decimal.js only. They pin the behaviour the
 * withdrawal flow relies on when deciding which funds are withdrawable.
 */

const bucket = (
  overrides: Partial<AllocationBucket> & { id: string },
): AllocationBucket => ({
  sourceType: 'DEPOSIT',
  wagerable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  availableAmount: '0',
  // Default: this deposit's wagering obligation is already satisfied, so the
  // bucket is withdrawable unless a test explicitly locks it.
  wageSatisfied: true,
  ...overrides,
});

describe('wallet-source-allocation — FIFO ordering', () => {
  it('orders buckets by createdAt then id, deterministically', () => {
    const b1 = bucket({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' });
    const b2 = bucket({ id: 'a', createdAt: '2026-01-02T00:00:00.000Z' });
    const b3 = bucket({ id: 'c', createdAt: '2026-01-01T00:00:00.000Z' });

    const ordered = [b1, b2, b3].sort(compareBucketsFifo).map((b) => b.id);
    expect(ordered).toEqual(['c', 'a', 'b']);

    expect([b2, b3, b1].sort(compareBucketsFifo).map((b) => b.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('wallet-source-allocation — source-aware eligibility', () => {
  it('keeps referral commission withdrawable while a deposit obligation is active (E4)', () => {
    const deposit = bucket({
      id: 'dep',
      sourceType: 'DEPOSIT',
      wagerable: true,
      wageSatisfied: false,
      availableAmount: '1000',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const referral = bucket({
      id: 'ref',
      sourceType: 'REFERRAL_COMMISSION',
      wagerable: false,
      wageSatisfied: false,
      availableAmount: '250',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    const plan = planAllocations([deposit, referral], '250');

    expect(plan.fullyFunded).toBe(true);
    expect(plan.withdrawableAmount.toFixed()).toBe('250');
    expect(plan.blockedWagerableAmount.toFixed()).toBe('1000');
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].bucketId).toBe('ref');
  });

  it('unlocks a wagerable bucket only once its obligation is satisfied', () => {
    const locked = bucket({
      id: 'locked',
      availableAmount: '100',
      wageSatisfied: false,
    });
    const satisfied = bucket({
      id: 'satisfied',
      availableAmount: '100',
      wageSatisfied: true,
    });

    expect(isBucketWithdrawable(locked)).toBe(false);
    expect(isBucketWithdrawable(satisfied)).toBe(true);

    const plan = planAllocations([locked, satisfied], '100');
    expect(plan.fullyFunded).toBe(true);
    expect(plan.legs.map((leg) => leg.bucketId)).toEqual(['satisfied']);
  });
});

describe('wallet-source-allocation — FIFO consumption', () => {
  it('consumes the oldest bucket first across MIXED sources (E5)', () => {
    const deposit = bucket({
      id: 'dep',
      sourceType: 'DEPOSIT',
      wagerable: true,
      wageSatisfied: true,
      availableAmount: '30',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const referral = bucket({
      id: 'ref',
      sourceType: 'REFERRAL_COMMISSION',
      wagerable: false,
      availableAmount: '50',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    const bonus = bucket({
      id: 'bon',
      sourceType: 'BONUS',
      wagerable: true,
      wageSatisfied: true,
      availableAmount: '40',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    const plan = planAllocations([bonus, referral, deposit], '100');

    expect(plan.fullyFunded).toBe(true);
    expect(plan.legs.map((leg) => [leg.bucketId, leg.amount.toFixed()])).toEqual([
      ['dep', '30'],
      ['ref', '50'],
      ['bon', '20'],
    ]);
    expect(plan.withdrawableAmount.toFixed()).toBe('120');
    expect(plan.shortage.toFixed()).toBe('0');
  });

  it('handles PARTIAL source consumption without over-allocating (E6)', () => {
    const a = bucket({ id: 'a', availableAmount: '10' });
    const b = bucket({ id: 'b', availableAmount: '10' });

    const plan = planAllocations([a, b], '15');

    expect(plan.legs.map((leg) => [leg.bucketId, leg.amount.toFixed()])).toEqual(
      [
        ['a', '10'],
        ['b', '5'],
      ],
    );
    const allocated = plan.legs.reduce(
      (sum, leg) => sum.plus(leg.amount),
      new Decimal(0),
    );
    expect(allocated.toFixed()).toBe('15');
  });

  it('reports a shortage and never over-allocates when funds are insufficient', () => {
    const a = bucket({ id: 'a', availableAmount: '7.5' });

    const plan = planAllocations([a], '10');

    expect(plan.fullyFunded).toBe(false);
    expect(plan.legs[0].amount.toFixed()).toBe('7.5');
    expect(plan.shortage.toFixed()).toBe('2.5');
  });

  it('never allocates the same source twice (each leg has a distinct bucket)', () => {
    const buckets = [
      bucket({ id: 'a', availableAmount: '5' }),
      bucket({ id: 'b', availableAmount: '5' }),
      bucket({ id: 'c', availableAmount: '5' }),
    ];

    const plan = planAllocations(buckets, '12');
    const ids = plan.legs.map((leg) => leg.bucketId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips zero/negative/invalid available capacity', () => {
    const plan = planAllocations(
      [
        bucket({ id: 'zero', availableAmount: '0' }),
        bucket({ id: 'neg', availableAmount: '-5' }),
        bucket({ id: 'bad', availableAmount: 'not-a-number' }),
        bucket({ id: 'ok', availableAmount: '3' }),
      ],
      '3',
    );

    expect(plan.legs.map((leg) => leg.bucketId)).toEqual(['ok']);
  });
});

describe('wallet-source-allocation — exact Decimal arithmetic (E17)', () => {
  it('preserves 18dp precision with no floating point drift', () => {
    const plan = planAllocations(
      [
        bucket({ id: 'a', availableAmount: '0.1' }),
        bucket({ id: 'b', availableAmount: '0.2' }),
      ],
      '0.3',
    );

    expect(plan.fullyFunded).toBe(true);
    const allocated = plan.legs.reduce(
      (sum, leg) => sum.plus(leg.amount),
      new Decimal(0),
    );
    expect(allocated.toFixed(18)).toBe('0.300000000000000000');
  });

  it('does not lose precision on very large values', () => {
    const huge = '123456789012345678.123456789012345678';
    const plan = planAllocations(
      [bucket({ id: 'h', availableAmount: huge })],
      huge,
    );
    expect(plan.legs[0].amount.toFixed(18)).toBe(new Decimal(huge).toFixed(18));
    expect(plan.shortage.toFixed(18)).toBe('0.000000000000000000');
  });

  it('treats a zero request as a no-op (fully funded, no legs)', () => {
    const plan = planAllocations([bucket({ id: 'a', availableAmount: '5' })], '0');
    expect(plan.legs).toHaveLength(0);
    expect(plan.fullyFunded).toBe(true);
  });
});

