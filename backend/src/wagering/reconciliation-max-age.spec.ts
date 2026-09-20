import {
  RECONCILIATION_MAX_AGE_DAYS_LIMIT,
  resolveReconciliationMaxAgeDays,
} from './wagering.service';

/**
 * E13 — reconciliationMaxAgeDays semantics.
 *
 * The audit finding was that `0` silently DISABLED reconciliation. The
 * intended meaning is now explicit: 0 == UNLIMITED (sweep all history since
 * activation), and any invalid value must fail safe by also meaning
 * UNLIMITED rather than turning the sweep off.
 */
describe('resolveReconciliationMaxAgeDays', () => {
  it('treats 0 as UNLIMITED (never "disabled")', () => {
    expect(resolveReconciliationMaxAgeDays(0)).toBe(0);
  });

  it('passes a positive window through unchanged', () => {
    expect(resolveReconciliationMaxAgeDays(30)).toBe(30);
    expect(resolveReconciliationMaxAgeDays(1)).toBe(1);
    expect(resolveReconciliationMaxAgeDays('45')).toBe(45);
  });

  it('fails safe for invalid values by returning UNLIMITED (0)', () => {
    expect(resolveReconciliationMaxAgeDays(-1)).toBe(0);
    expect(resolveReconciliationMaxAgeDays(-9999)).toBe(0);
    expect(resolveReconciliationMaxAgeDays(Number.NaN)).toBe(0);
    expect(resolveReconciliationMaxAgeDays(Number.POSITIVE_INFINITY)).toBe(0);
    expect(resolveReconciliationMaxAgeDays('not-a-number')).toBe(0);
    expect(resolveReconciliationMaxAgeDays(undefined)).toBe(0);
    expect(resolveReconciliationMaxAgeDays(null)).toBe(0);
  });

  it('floors fractional values and caps at the hard limit', () => {
    expect(resolveReconciliationMaxAgeDays(30.9)).toBe(30);
    expect(resolveReconciliationMaxAgeDays(RECONCILIATION_MAX_AGE_DAYS_LIMIT + 100)).toBe(
      RECONCILIATION_MAX_AGE_DAYS_LIMIT,
    );
  });
});
