// backend/src/modules/period-sync/wingo-period-number.ts
//
// Authoritative WinGo period-number encoding (TPPLAY reference contract).
//
// FROZEN CONTRACT — the layout below is the exact scheme the reference source
// uses for its `issueNumber`. Every synced round number must be reproducible
// from the period's own END timestamp, so this module is the single source of
// truth for:
//
//   - runtime invariant checks (LottoService.ensureSyncedRound warns when the
//     reference payload disagrees with its own encoding), and
//   - the 1790000000000 data migration that rekeys legacy locally-generated
//     period numbers (000006, 000007, …) to the authoritative format.
//
// Layout (17 chars):
//
//   YYYYMMDD + "1000" + <game digit> + <4-digit period sequence in the UTC day>
//
//   THIRTY_SEC -> game digit 5, 2880 periods/day,  30s each  (WinGo_30S)
//   ONE_MIN    -> game digit 1, 1440 periods/day,  60s each  (WinGo_1M)
//   THREE_MIN  -> game digit 2,  480 periods/day, 180s each  (WinGo_3M)
//   FIVE_MIN   -> game digit 3,  288 periods/day, 300s each  (WinGo_5M)
//
// A period END is an exclusive boundary: a period that ends exactly at
// 00:00:00.000 UTC is the LAST period of the PREVIOUS UTC day (sequence =
// periods/day). Verified against live reference payloads and live DB rows:
//
//   1M  end 2026-09-15T08:23:00Z -> 20260915100010503
//   3M  end 2026-09-15T08:24:00Z -> 20260915100020168
//   5M  end 2026-09-15T08:25:00Z -> 20260915100030101
//   30S end 2026-09-15T08:23:00Z -> 20260915100051006
//   30S end 2026-09-15T00:00:00Z -> 20260914100052880 (previous UTC day)
//
// TEN_MIN has no reference source and therefore no authoritative encoding.

export interface WingoCategoryEncoding {
  /** Single digit identifying the game inside the period number. */
  gameDigit: string;
  /** Period length in milliseconds. */
  durationMs: number;
  /** Periods per UTC day (the highest valid sequence). */
  periodsPerDay: number;
  /** Authoritative reference game code. */
  gameCode: string;
}

/** Period number shape shared by every reference-backed category. */
export const AUTHORITATIVE_WINGO_PERIOD_PATTERN = /^\d{8}1000\d{5}$/;

const MS_PER_DAY = 86_400_000;
/** Index of the single game digit inside a 17-char period number. */
const GAME_DIGIT_INDEX = 12;

export const WINGO_CATEGORY_ENCODING: Readonly<
  Record<string, WingoCategoryEncoding>
> = Object.freeze({
  THIRTY_SEC: {
    gameDigit: '5',
    durationMs: 30_000,
    periodsPerDay: 2_880,
    gameCode: 'WinGo_30S',
  },
  ONE_MIN: {
    gameDigit: '1',
    durationMs: 60_000,
    periodsPerDay: 1_440,
    gameCode: 'WinGo_1M',
  },
  THREE_MIN: {
    gameDigit: '2',
    durationMs: 180_000,
    periodsPerDay: 480,
    gameCode: 'WinGo_3M',
  },
  FIVE_MIN: {
    gameDigit: '3',
    durationMs: 300_000,
    periodsPerDay: 288,
    gameCode: 'WinGo_5M',
  },
});

export const REFERENCE_BACKED_CATEGORIES: readonly string[] = Object.freeze(
  Object.keys(WINGO_CATEGORY_ENCODING),
);

const pad = (value: number, size: number): string =>
  String(value).padStart(size, '0');

export const getCategoryEncoding = (
  category: string,
): WingoCategoryEncoding | null => WINGO_CATEGORY_ENCODING[category] ?? null;

/** Shape check only — does NOT verify the game digit belongs to `category`. */
export const isAuthoritativeWingoPeriodNumber = (
  value: unknown,
): value is string =>
  typeof value === 'string' && AUTHORITATIVE_WINGO_PERIOD_PATTERN.test(value);

/**
 * True when `value` is the authoritative period number of `category` itself
 * (correct shape AND the category's own game digit).
 */
export const isAuthoritativeWingoPeriodNumberForCategory = (
  category: string,
  value: unknown,
): boolean => {
  const encoding = getCategoryEncoding(category);
  if (!encoding || !isAuthoritativeWingoPeriodNumber(value)) {
    return false;
  }

  return value.charAt(GAME_DIGIT_INDEX) === encoding.gameDigit;
};

export interface WingoPeriodSlot {
  /** UTC midnight (epoch ms) of the day the period END belongs to. */
  dayMs: number;
  /** 1-based period sequence within that UTC day. */
  sequence: number;
}

/**
 * Maps a period END instant to the authoritative (day, sequence) slot.
 * Returns null for categories without a reference source.
 */
export const resolveWingoPeriodSlot = (
  category: string,
  endTimeMs: number,
): WingoPeriodSlot | null => {
  const encoding = getCategoryEncoding(category);
  if (!encoding || !Number.isFinite(endTimeMs)) {
    return null;
  }

  // A period ending exactly at UTC midnight belongs to the previous UTC day.
  const endsAtUtcMidnight = endTimeMs % MS_PER_DAY === 0;
  const dayAnchor = new Date(endsAtUtcMidnight ? endTimeMs - 1 : endTimeMs);
  const dayMs = Date.UTC(
    dayAnchor.getUTCFullYear(),
    dayAnchor.getUTCMonth(),
    dayAnchor.getUTCDate(),
  );

  const rawSequence = Math.round((endTimeMs - dayMs) / encoding.durationMs);
  const sequence = Math.min(Math.max(rawSequence, 1), encoding.periodsPerDay);

  return { dayMs, sequence };
};

/** Encodes a (day, sequence) slot into the 17-char authoritative number. */
export const formatWingoPeriodNumberFromSlot = (
  category: string,
  dayMs: number,
  sequence: number,
): string | null => {
  const encoding = getCategoryEncoding(category);
  if (!encoding || !Number.isFinite(dayMs) || !Number.isFinite(sequence)) {
    return null;
  }

  const day = new Date(dayMs);
  return (
    pad(day.getUTCFullYear(), 4) +
    pad(day.getUTCMonth() + 1, 2) +
    pad(day.getUTCDate(), 2) +
    '1000' +
    encoding.gameDigit +
    pad(sequence, 4)
  );
};

/** Encodes the authoritative period number covering `endTimeMs`. */
export const formatWingoPeriodNumber = (
  category: string,
  endTimeMs: number,
): string | null => {
  const slot = resolveWingoPeriodSlot(category, endTimeMs);
  if (!slot) {
    return null;
  }

  return formatWingoPeriodNumberFromSlot(category, slot.dayMs, slot.sequence);
};

/** Previous slot (sequence - 1), wrapping into the previous UTC day. */
export const previousWingoPeriodSlot = (
  category: string,
  dayMs: number,
  sequence: number,
): WingoPeriodSlot | null => {
  const encoding = getCategoryEncoding(category);
  if (!encoding) {
    return null;
  }

  return sequence > 1
    ? { dayMs, sequence: sequence - 1 }
    : { dayMs: dayMs - MS_PER_DAY, sequence: encoding.periodsPerDay };
};