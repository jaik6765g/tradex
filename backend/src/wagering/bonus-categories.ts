// src/wagering/bonus-categories.ts
// ============================================================
// BONUS CATEGORY POLICY (pure, side-effect free)
// ============================================================
//
// Single source of truth for the admin bonus-distribution categories and
// their wagering policy. Salary is NOT a separate module/table/service —
// it is handled as the SALARY_BONUS bonus category inside the existing
// bonus distribution flow.
//
// Wagering policy:
//   - Every category except REFERRAL_BONUS allows the admin to choose
//     YES / NO for "wagering required".
//   - REFERRAL_BONUS is referral commission: wagering is ALWAYS disabled
//     and a YES request is rejected (never silently downgraded).
//
// Multiplier policy:
//   - Presets 1 / 2 / 3 or CUSTOM (any positive decimal, capped).
//   - All arithmetic stays in Decimal.js — never floats.
// ============================================================

import Decimal from 'decimal.js';

export const BONUS_CATEGORY = {
  DEPOSIT_BONUS: 'DEPOSIT_BONUS',
  SALARY_BONUS: 'SALARY_BONUS',
  REFERRAL_BONUS: 'REFERRAL_BONUS',
  WELCOME_BONUS: 'WELCOME_BONUS',
  PROMOTIONAL_BONUS: 'PROMOTIONAL_BONUS',
  CASHBACK_BONUS: 'CASHBACK_BONUS',
  MANUAL_BONUS: 'MANUAL_BONUS',
} as const;

export type BonusCategory = (typeof BONUS_CATEGORY)[keyof typeof BONUS_CATEGORY];

/** Immutable, ordered list of the seven supported bonus categories. */
export const ALL_BONUS_CATEGORIES: readonly BonusCategory[] = [
  BONUS_CATEGORY.DEPOSIT_BONUS,
  BONUS_CATEGORY.SALARY_BONUS,
  BONUS_CATEGORY.REFERRAL_BONUS,
  BONUS_CATEGORY.WELCOME_BONUS,
  BONUS_CATEGORY.PROMOTIONAL_BONUS,
  BONUS_CATEGORY.CASHBACK_BONUS,
  BONUS_CATEGORY.MANUAL_BONUS,
] as const;

/** Categories where wagering can NEVER be required (forced non-wagerable). */
export const WAGERING_ALWAYS_DISABLED_CATEGORIES: readonly BonusCategory[] = [
  BONUS_CATEGORY.REFERRAL_BONUS,
] as const;

/** Hard cap for any wagering multiplier (preset or CUSTOM). */
export const MAX_BONUS_WAGERING_MULTIPLIER = 100;

export function normalizeBonusCategory(value: unknown): BonusCategory | null {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  return (ALL_BONUS_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as BonusCategory)
    : null;
}

export function isWageringDisabledForCategory(
  category: BonusCategory,
): boolean {
  return (WAGERING_ALWAYS_DISABLED_CATEGORIES as readonly string[]).includes(
    category,
  );
}

export type MultiplierValidation =
  | { ok: true; multiplier: Decimal }
  | { ok: false; reason: string };

/**
 * Validates a wagering multiplier supplied by an admin.
 * Accepts numbers or exact decimal strings: positive, finite, ≤ MAX.
 * Never routes through parseFloat/Number — Decimal.js only.
 */
export function validateBonusWageringMultiplier(
  value: string | number | Decimal,
): MultiplierValidation {
  let multiplier: Decimal;
  try {
    multiplier = new Decimal(
      typeof value === 'object' ? value.toString() : String(value ?? ''),
    );
  } catch {
    return { ok: false, reason: 'wageringMultiplier must be a valid decimal number' };
  }

  if (!multiplier.isFinite()) {
    return { ok: false, reason: 'wageringMultiplier must be a finite number' };
  }
  if (multiplier.lte(0)) {
    return {
      ok: false,
      reason: 'wageringMultiplier must be greater than zero',
    };
  }
  if (multiplier.gt(MAX_BONUS_WAGERING_MULTIPLIER)) {
    return {
      ok: false,
      reason: `wageringMultiplier must not exceed ${MAX_BONUS_WAGERING_MULTIPLIER}`,
    };
  }
  return { ok: true, multiplier };
}
