// src/wagering/wagering-source.ts
// ============================================================
// WAGERING / FUND SOURCE CLASSIFICATION (pure, side-effect free)
// ============================================================
//
// Single source of truth for "which money is wagerable?".
//
// Business policy (mandated):
//   WAGERABLE .......... DEPOSIT, BONUS
//   NON-WAGERABLE ...... REFERRAL_COMMISSION, SALARY, LEGACY, OTHER
//
// The helpers below are intentionally dependency-free so they can be unit
// tested directly and reused by:
//   - WageringService       (obligation creation + withdrawal enforcement)
//   - WalletSourceService   (FIFO attribution buckets)
//   - reconciliation        (attribution mismatch detection)
//
// Money is never handled here — only classification strings. All monetary
// arithmetic stays in Decimal.js at the call sites.
// ============================================================

import { LedgerType } from '../ledger/ledger.entity';

// ------------------------------------------------------------
// OBLIGATION SOURCE TYPES
// ------------------------------------------------------------

/**
 * The ONLY source types that may create a wagering obligation.
 * Adding a value here is a policy change and must be reviewed.
 */
export const WAGERING_SOURCE_TYPE = {
  DEPOSIT: 'DEPOSIT',
  BONUS: 'BONUS',
} as const;

export type WageringSourceType =
  (typeof WAGERING_SOURCE_TYPE)[keyof typeof WAGERING_SOURCE_TYPE];

/** Immutable, ordered allowlist of wagerable obligation sources. */
export const WAGERABLE_SOURCE_TYPES: readonly WageringSourceType[] = [
  WAGERING_SOURCE_TYPE.DEPOSIT,
  WAGERING_SOURCE_TYPE.BONUS,
] as const;

// ------------------------------------------------------------
// FUND SOURCE TYPES (attribution buckets — superset)
// ------------------------------------------------------------

/**
 * Every credited amount receives exactly ONE of these classifications.
 * `LEGACY` is reserved for pre-attribution (existing, untagged) funds that
 * a backfill migration explicitly records — it is NEVER assigned to new
 * credits.
 */
export const FUND_SOURCE_TYPE = {
  DEPOSIT: 'DEPOSIT',
  BONUS: 'BONUS',
  REFERRAL_COMMISSION: 'REFERRAL_COMMISSION',
  SALARY: 'SALARY',
  LEGACY: 'LEGACY',
  OTHER: 'OTHER',
} as const;

export type FundSourceType =
  (typeof FUND_SOURCE_TYPE)[keyof typeof FUND_SOURCE_TYPE];

/** All known fund source types (used for validation + repair). */
export const ALL_FUND_SOURCE_TYPES: readonly FundSourceType[] = [
  FUND_SOURCE_TYPE.DEPOSIT,
  FUND_SOURCE_TYPE.BONUS,
  FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
  FUND_SOURCE_TYPE.SALARY,
  FUND_SOURCE_TYPE.LEGACY,
  FUND_SOURCE_TYPE.OTHER,
] as const;

// ------------------------------------------------------------
// REFERENCE TYPES (ledger evidence → source classification)
// ------------------------------------------------------------

/**
 * Ledger `referenceType` values that identify referral commission credits.
 * These are the exact strings written by the existing referral flows —
 * verified against:
 *   - bot.service.ts    → 'BOT_FIRST_ACTIVATION_REFERRAL'
 *   - lotto.service.ts  → 'REFERRAL_BONUS'
 */
export const REFERRAL_REFERENCE_TYPES: readonly string[] = [
  'REFERRAL_BONUS',
  'BOT_FIRST_ACTIVATION_REFERRAL',
];

/** Ledger `referenceType` written for every manual admin bonus distribution. */
export const BONUS_REFERENCE_TYPE = 'ADMIN_BONUS';

/**
 * Ledger types that can never carry wagerable value. Kept as a defensive
 * guard so a future credit path cannot accidentally become wagerable.
 */
export const NON_WAGERABLE_LEDGER_TYPES: readonly LedgerType[] = [
  LedgerType.GAME_WIN,
  LedgerType.TRADE_PROFIT,
  LedgerType.TRADE_DRAW,
  LedgerType.WITHDRAWAL_RELEASE,
  LedgerType.BOT_FIRST_ACTIVATION_REFERRAL,
  LedgerType.BOT_FIRST_ACTIVATION_LIQUIDITY,
];

// ------------------------------------------------------------
// PREDICATES
// ------------------------------------------------------------

/**
 * Normalizes an arbitrary value into a fund source type.
 * Unknown / missing values become `OTHER` (never silently wagerable).
 */
export function normalizeFundSourceType(value: unknown): FundSourceType {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  const match = ALL_FUND_SOURCE_TYPES.find((candidate) => candidate === raw);
  return match ?? FUND_SOURCE_TYPE.OTHER;
}

/**
 * True only for explicitly wagerable sources (DEPOSIT, BONUS).
 * Anything unknown is non-wagerable by default — fail closed.
 */
export function isWagerableSourceType(value: unknown): boolean {
  const normalized = normalizeFundSourceType(value);
  return (WAGERABLE_SOURCE_TYPES as readonly string[]).includes(normalized);
}

/**
 * True only for explicitly non-wagerable sources.
 * Complementary to `isWagerableSourceType`, exposed for audit clarity.
 */
export function isNonWagerableSourceType(value: unknown): boolean {
  return !isWagerableSourceType(value);
}

// ------------------------------------------------------------
// LEDGER → SOURCE CLASSIFICATION (backfill + repair)
// ------------------------------------------------------------

/**
 * Classifies a credit ledger entry into a fund source type using ONLY
 * ledger evidence (type + referenceType). Used by the attribution backfill
 * migration/repair and by reconciliation.
 *
 * Order matters:
 *   1. BONUS  — ADMIN_ADJUSTMENT with the admin-bonus reference type.
 *   2. REFERRAL_COMMISSION — referral reference types (explicitly exempt).
 *   3. DEPOSIT — the deposit credit ledger type.
 *   4. Otherwise OTHER (never wagerable).
 *
 * NOTE: `ADMIN_ADJUSTMENT` without the ADMIN_BONUS reference type is a
 * generic admin correction and is deliberately classified as OTHER, so a
 * manual correction can never become wagerable by accident.
 */
export function classifyLedgerCredit(input: {
  ledgerType: string | null | undefined;
  referenceType: string | null | undefined;
}): FundSourceType {
  const ledgerType = String(input.ledgerType ?? '')
    .trim()
    .toUpperCase();
  const referenceType = String(input.referenceType ?? '')
    .trim()
    .toUpperCase();

  if (
    ledgerType === String(LedgerType.ADMIN_ADJUSTMENT) &&
    referenceType === BONUS_REFERENCE_TYPE
  ) {
    return FUND_SOURCE_TYPE.BONUS;
  }

  if (REFERRAL_REFERENCE_TYPES.includes(referenceType)) {
    return FUND_SOURCE_TYPE.REFERRAL_COMMISSION;
  }

  if (ledgerType === String(LedgerType.DEPOSIT)) {
    return FUND_SOURCE_TYPE.DEPOSIT;
  }

  return FUND_SOURCE_TYPE.OTHER;
}