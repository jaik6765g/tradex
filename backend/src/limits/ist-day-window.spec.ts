import {
  DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY,
  getIstDayWindow,
  parseDailyWithdrawalFrequency,
} from './limits.service';

// ============================================================
// Asia/Kolkata (UTC+05:30) day-boundary behavior
// ============================================================

const IST = 5.5 * 60 * 60 * 1000;

describe('getIstDayWindow — Asia/Kolkata day boundaries', () => {
  it('uses a 00:00–24:00 IST window expressed as UTC instants', () => {
    // 2026-09-17T10:00:00Z == 15:30 IST on 2026-09-17
    const window = getIstDayWindow(new Date('2026-09-17T10:00:00.000Z'));

    // IST midnight for 2026-09-17 is 2026-09-16T18:30:00Z
    expect(window.startUtc.toISOString()).toBe('2026-09-16T18:30:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-09-17T18:30:00.000Z');
    expect(window.resetsAtIso).toBe('2026-09-17T18:30:00.000Z');
    expect(window.endUtc.getTime() - window.startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('treats 23:59 IST and 00:01 IST as DIFFERENT days', () => {
    // 2026-09-17T18:29:00Z == 23:59 IST 2026-09-17
    const lateIst = getIstDayWindow(new Date('2026-09-17T18:29:00.000Z'));
    // 2026-09-17T18:31:00Z == 00:01 IST 2026-09-18
    const earlyIstNextDay = getIstDayWindow(new Date('2026-09-17T18:31:00.000Z'));

    expect(lateIst.startUtc.toISOString()).toBe('2026-09-16T18:30:00.000Z');
    expect(earlyIstNextDay.startUtc.toISOString()).toBe('2026-09-17T18:30:00.000Z');

    // The 00:01 IST transaction falls OUTSIDE the previous IST day window.
    expect(earlyIstNextDay.startUtc.getTime()).toBeGreaterThan(
      lateIst.endUtc.getTime() - 24 * 60 * 60 * 1000,
    );
    expect(lateIst.endUtc.getTime()).toBe(earlyIstNextDay.startUtc.getTime());
  });

  it('computes resetsAt as the next IST midnight in UTC ISO form', () => {
    // 2026-09-17T18:30:00Z is exactly IST midnight of 2026-09-18
    const atIstMidnight = getIstDayWindow(new Date('2026-09-17T18:30:00.000Z'));
    const justBefore = getIstDayWindow(new Date('2026-09-17T18:29:59.999Z'));

    expect(atIstMidnight.startUtc.toISOString()).toBe('2026-09-17T18:30:00.000Z');
    expect(atIstMidnight.resetsAtIso).toBe('2026-09-18T18:30:00.000Z');
    expect(justBefore.resetsAtIso).toBe('2026-09-17T18:30:00.000Z');
  });

  it('is offset-correct across a UTC date line (same IST day, different UTC days)', () => {
    const a = getIstDayWindow(new Date(Date.UTC(2026, 0, 5, 19, 0, 0))); // 00:30 IST Jan 6
    const b = getIstDayWindow(new Date(Date.UTC(2026, 0, 6, 10, 0, 0))); // 15:30 IST Jan 6

    expect(a.startUtc.toISOString()).toBe(b.startUtc.toISOString());
    expect(a.startUtc.toISOString()).toBe('2026-01-05T18:30:00.000Z');
  });

  it('applies the IST offset (not server-local time)', () => {
    const window = getIstDayWindow(new Date('2026-09-17T10:00:00.000Z'));
    const istShifted = window.startUtc.getTime() + IST;
    expect(new Date(istShifted).toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });
});

// ============================================================
// Daily withdrawal frequency setting representation
// ============================================================

describe('parseDailyWithdrawalFrequency', () => {
  it('parses the canonical COUNT representation', () => {
    expect(parseDailyWithdrawalFrequency('{"mode":"COUNT","value":5}')).toEqual({
      mode: 'COUNT',
      value: 5,
    });
  });

  it('parses the canonical UNLIMITED representation', () => {
    expect(parseDailyWithdrawalFrequency('{"mode":"UNLIMITED"}')).toEqual({
      mode: 'UNLIMITED',
    });
  });

  it('is backward compatible with the legacy numeric representation', () => {
    expect(parseDailyWithdrawalFrequency('3')).toEqual({ mode: 'COUNT', value: 3 });
    expect(parseDailyWithdrawalFrequency(' 10 ')).toEqual({
      mode: 'COUNT',
      value: 10,
    });
    expect(parseDailyWithdrawalFrequency('1')).toEqual({ mode: 'COUNT', value: 1 });
    expect(parseDailyWithdrawalFrequency('2')).toEqual({ mode: 'COUNT', value: 2 });
  });

  it('maps legacy 0 / non-positive (check disabled) to UNLIMITED', () => {
    expect(parseDailyWithdrawalFrequency('0')).toEqual({ mode: 'UNLIMITED' });
    expect(parseDailyWithdrawalFrequency('-1')).toEqual({ mode: 'UNLIMITED' });
  });

  it('falls back to the approved default (3/day) for missing or malformed values', () => {
    const fallback = {
      mode: 'COUNT',
      value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY,
    };
    expect(parseDailyWithdrawalFrequency(null)).toEqual(fallback);
    expect(parseDailyWithdrawalFrequency(undefined)).toEqual(fallback);
    expect(parseDailyWithdrawalFrequency('')).toEqual(fallback);
    expect(parseDailyWithdrawalFrequency('not-a-number')).toEqual(fallback);
    expect(parseDailyWithdrawalFrequency('{"mode":"COUNT","value":0}')).toEqual(
      fallback,
    );
    expect(parseDailyWithdrawalFrequency('{"mode":"BOGUS"}')).toEqual(fallback);
    expect(parseDailyWithdrawalFrequency('{broken json')).toEqual(fallback);
  });
});