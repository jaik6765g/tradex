import {
  ALL_FUND_SOURCE_TYPES,
  BONUS_REFERENCE_TYPE,
  FUND_SOURCE_TYPE,
  REFERRAL_REFERENCE_TYPES,
  WAGERABLE_SOURCE_TYPES,
  WAGERING_SOURCE_TYPE,
  classifyLedgerCredit,
  isNonWagerableSourceType,
  isWagerableSourceType,
  normalizeFundSourceType,
} from './wagering-source';

/**
 * Phase A2 / E18 / E19 — generic wagering source model policy.
 *
 * These tests pin the business rule that ONLY deposits and bonuses are
 * wagerable, and that referral commission (plus salary/legacy/other) can
 * never create a wagering obligation — directly or by accident.
 */
describe('wagering-source — fund source classification', () => {
  it('has exactly DEPOSIT and BONUS on the wagerable allowlist', () => {
    expect([...WAGERABLE_SOURCE_TYPES]).toEqual([
      WAGERING_SOURCE_TYPE.DEPOSIT,
      WAGERING_SOURCE_TYPE.BONUS,
    ]);
  });

  it('treats DEPOSIT and BONUS as wagerable', () => {
    expect(isWagerableSourceType(FUND_SOURCE_TYPE.DEPOSIT)).toBe(true);
    expect(isWagerableSourceType(FUND_SOURCE_TYPE.BONUS)).toBe(true);
  });

  it('never treats referral commission / salary / legacy / other as wagerable', () => {
    for (const sourceType of [
      FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      FUND_SOURCE_TYPE.SALARY,
      FUND_SOURCE_TYPE.LEGACY,
      FUND_SOURCE_TYPE.OTHER,
    ]) {
      expect(isWagerableSourceType(sourceType)).toBe(false);
      expect(isNonWagerableSourceType(sourceType)).toBe(true);
    }
  });

  it('fails closed for unknown/missing sources (never silently wagerable)', () => {
    expect(normalizeFundSourceType('MYSTERY_SOURCE')).toBe(
      FUND_SOURCE_TYPE.OTHER,
    );
    expect(isWagerableSourceType('MYSTERY_SOURCE')).toBe(false);
    expect(normalizeFundSourceType(undefined)).toBe(FUND_SOURCE_TYPE.OTHER);
    expect(normalizeFundSourceType(null)).toBe(FUND_SOURCE_TYPE.OTHER);
    expect(isWagerableSourceType(undefined)).toBe(false);
  });

  it('normalizes case/whitespace and known values only', () => {
    expect(normalizeFundSourceType('  bonus ')).toBe(FUND_SOURCE_TYPE.BONUS);
    expect(ALL_FUND_SOURCE_TYPES).toContain(FUND_SOURCE_TYPE.SALARY);
  });

  // ------------------------------------------------------------------
  // Ledger-evidence classification (used by backfill + reconciliation)
  // ------------------------------------------------------------------

  it('classifies every referral reference type as REFERRAL_COMMISSION (E19)', () => {
    for (const referenceType of REFERRAL_REFERENCE_TYPES) {
      const classified = classifyLedgerCredit({
        ledgerType: 'GAME_WIN',
        referenceType,
      });
      expect(classified).toBe(FUND_SOURCE_TYPE.REFERRAL_COMMISSION);
      expect(isWagerableSourceType(classified)).toBe(false);
    }
  });

  it('classifies an admin bonus as BONUS only with the ADMIN_BONUS reference', () => {
    expect(
      classifyLedgerCredit({
        ledgerType: 'ADMIN_ADJUSTMENT',
        referenceType: BONUS_REFERENCE_TYPE,
      }),
    ).toBe(FUND_SOURCE_TYPE.BONUS);

    // A generic admin correction must NOT become wagerable by accident.
    expect(
      classifyLedgerCredit({
        ledgerType: 'ADMIN_ADJUSTMENT',
        referenceType: 'MANUAL_CORRECTION',
      }),
    ).toBe(FUND_SOURCE_TYPE.OTHER);
  });

  it('classifies deposit credits as DEPOSIT', () => {
    expect(
      classifyLedgerCredit({ ledgerType: 'DEPOSIT', referenceType: 'deposit' }),
    ).toBe(FUND_SOURCE_TYPE.DEPOSIT);
  });

  it('classifies unrecognized credits as OTHER (non-wagerable fallback)', () => {
    expect(
      classifyLedgerCredit({ ledgerType: 'WITHDRAWAL_RELEASE', referenceType: null }),
    ).toBe(FUND_SOURCE_TYPE.OTHER);
    expect(
      classifyLedgerCredit({ ledgerType: null, referenceType: null }),
    ).toBe(FUND_SOURCE_TYPE.OTHER);
  });
});
