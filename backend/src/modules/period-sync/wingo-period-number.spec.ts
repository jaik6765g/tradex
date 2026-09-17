// backend/src/modules/period-sync/wingo-period-number.spec.ts
//
// Authoritative WinGo period-number encoding contract.
//
// Every vector below was captured from the live reference payloads and/or the
// live lotto_rounds rows that were created from them, so the encoding is pinned
// to real TPPLAY data rather than to itself.
import {
  AUTHORITATIVE_WINGO_PERIOD_PATTERN,
  formatWingoPeriodNumber,
  formatWingoPeriodNumberFromSlot,
  getCategoryEncoding,
  isAuthoritativeWingoPeriodNumber,
  isAuthoritativeWingoPeriodNumberForCategory,
  previousWingoPeriodSlot,
  resolveWingoPeriodSlot,
  WINGO_CATEGORY_ENCODING,
} from './wingo-period-number';

describe('WinGo period-number encoding', () => {
  // 2026-09-15T08:23:00.000Z — current 30S/1M boundary observed live.
  const END_0823 = Date.UTC(2026, 8, 15, 8, 23, 0, 0);
  const END_0824 = Date.UTC(2026, 8, 15, 8, 24, 0, 0);
  const END_0825 = Date.UTC(2026, 8, 15, 8, 25, 0, 0);
  // Exact UTC midnight — last period of the PREVIOUS UTC day.
  const END_MIDNIGHT = Date.UTC(2026, 8, 15, 0, 0, 0, 0);

  it('reproduces the reference period numbers (live vectors)', () => {
    expect(formatWingoPeriodNumber('THIRTY_SEC', END_0823)).toBe(
      '20260915100051006',
    );
    expect(formatWingoPeriodNumber('ONE_MIN', END_0823)).toBe(
      '20260915100010503',
    );
    expect(formatWingoPeriodNumber('THREE_MIN', END_0824)).toBe(
      '20260915100020168',
    );
    expect(formatWingoPeriodNumber('FIVE_MIN', END_0825)).toBe(
      '20260915100030101',
    );
  });

  it('treats a UTC-midnight boundary as the previous day last period', () => {
    expect(formatWingoPeriodNumber('THIRTY_SEC', END_MIDNIGHT)).toBe(
      '20260914100052880',
    );
    expect(resolveWingoPeriodSlot('THIRTY_SEC', END_MIDNIGHT)).toEqual({
      dayMs: Date.UTC(2026, 8, 14),
      sequence: 2_880,
    });
  });

  it('has no authoritative encoding for a category without a reference game', () => {
    expect(formatWingoPeriodNumber('TEN_MIN', END_0823)).toBeNull();
    expect(getCategoryEncoding('TEN_MIN')).toBeNull();
  });

  it('matches only the exact authoritative shape', () => {
    expect(isAuthoritativeWingoPeriodNumber('20260915100010503')).toBe(true);
    expect(isAuthoritativeWingoPeriodNumber('002922')).toBe(false);
    expect(isAuthoritativeWingoPeriodNumber('000006')).toBe(false);
    expect(isAuthoritativeWingoPeriodNumber(null)).toBe(false);
    expect(
      AUTHORITATIVE_WINGO_PERIOD_PATTERN.test('20260915100010503'),
    ).toBe(true);
  });

  it('rejects an authoritative number that belongs to another game', () => {
    // A ONE_MIN number must never be accepted for the THIRTY_SEC category.
    expect(
      isAuthoritativeWingoPeriodNumberForCategory(
        'THIRTY_SEC',
        '20260915100010428',
      ),
    ).toBe(false);
    expect(
      isAuthoritativeWingoPeriodNumberForCategory(
        'ONE_MIN',
        '20260915100010503',
      ),
    ).toBe(true);
  });

  it('walks backwards to the previous slot, wrapping across the UTC day', () => {
    expect(previousWingoPeriodSlot('ONE_MIN', Date.UTC(2026, 8, 15), 5)).toEqual(
      { dayMs: Date.UTC(2026, 8, 15), sequence: 4 },
    );
    expect(previousWingoPeriodSlot('ONE_MIN', Date.UTC(2026, 8, 15), 1)).toEqual(
      { dayMs: Date.UTC(2026, 8, 14), sequence: 1_440 },
    );
  });

  it('encodes every category with its own game digit and cadence', () => {
    expect(Object.keys(WINGO_CATEGORY_ENCODING).sort()).toEqual([
      'FIVE_MIN',
      'ONE_MIN',
      'THIRTY_SEC',
      'THREE_MIN',
    ]);
    expect(
      formatWingoPeriodNumberFromSlot('FIVE_MIN', Date.UTC(2026, 8, 15), 2),
    ).toBe('20260915100030002');
    expect(
      formatWingoPeriodNumberFromSlot('TEN_MIN', Date.UTC(2026, 8, 15), 2),
    ).toBeNull();
  });
});
