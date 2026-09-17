// backend/src/modules/lotto/utils/lotto-win-strategy.util.ts
//
// Pure helpers for the LOTTO win-strategy draw engine.
//
// Definitions
// -----------
// Win potential of a symbol X = the total payout the house would owe if X were
// the winning result = SUM(netAmount * multiplier) over every unsettled ticket
// that selected X. It is the authoritative "exposure" of one symbol: it matches
// exactly what settleTicketForRound() pays out (netAmount * multiplier) for a
// winning ticket, so the ladder and the settlement can never disagree.
//
// Strategies
// ----------
// RANDOM  no steering — the draw is a uniform random symbol (default).
// HIGH    the symbol with the HIGHEST win potential wins (most players win).
// MEDIUM  the symbol whose win potential is closest to the mid-point of the
//         observed [lowest, highest] range wins (a genuinely mid payout).
// LOW     the symbol with the LOWEST win potential wins (fewest players win).
//
// When no symbol carries any stake (all win potentials are zero) the strategy
// has no signal, so the caller falls back to a uniform random draw.

export const LOTTO_RESULT_SYMBOLS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
] as const;

export const WIN_STRATEGY_VALUES = [
  'RANDOM',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type WinStrategy = (typeof WIN_STRATEGY_VALUES)[number];

export const DEFAULT_WIN_STRATEGY: WinStrategy = 'RANDOM';

const SYMBOL_ORDER = new Map<string, number>(
  LOTTO_RESULT_SYMBOLS.map((symbol, index) => [symbol, index]),
);

export interface WinPotentialOption {
  option: string;
  betCount: number;
  winPotential: number;
}

export interface WinPotentialTiers {
  highest: string[];
  medium: string[];
  lowest: string[];
}

export interface WinPotentialRow {
  option: string;
  betCount?: number | string | null;
  winPotential?: number | string | null;
}

export function isWinStrategy(value: unknown): value is WinStrategy {
  return (
    typeof value === 'string' &&
    (WIN_STRATEGY_VALUES as readonly string[]).includes(value)
  );
}

/** Normalizes a persisted setting value into a supported strategy. */
export function normalizeWinStrategy(
  value: string | null | undefined,
): WinStrategy {
  if (!value) {
    return DEFAULT_WIN_STRATEGY;
  }

  const normalized = value.trim().toUpperCase();
  return isWinStrategy(normalized) ? normalized : DEFAULT_WIN_STRATEGY;
}

export function toWinPotential2Dp(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const symbolRank = (option: string): number =>
  SYMBOL_ORDER.get(option.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;

const normalizeSymbol = (option: string): string => option.trim().toUpperCase();

/**
 * Builds the full 16-symbol ladder (missing symbols default to zero) sorted
 * ascending by win potential, then by canonical symbol order so every
 * downstream tie-break is deterministic.
 */
export function buildWinPotentialLadder(
  rows: readonly WinPotentialRow[],
): WinPotentialOption[] {
  const byOption = new Map<string, WinPotentialOption>();

  for (const symbol of LOTTO_RESULT_SYMBOLS) {
    byOption.set(symbol, { option: symbol, betCount: 0, winPotential: 0 });
  }

  for (const row of rows) {
    const option = normalizeSymbol(String(row.option ?? ''));
    if (!byOption.has(option)) {
      continue;
    }

    const target = byOption.get(option)!;
    const rawPotential = Number(row.winPotential ?? 0);
    const rawBetCount = Number(row.betCount ?? 0);

    if (Number.isFinite(rawPotential)) {
      target.winPotential = toWinPotential2Dp(target.winPotential + rawPotential);
    }
    if (Number.isFinite(rawBetCount)) {
      target.betCount += Math.trunc(rawBetCount);
    }
  }

  return Array.from(byOption.values()).sort(
    (a, b) =>
      a.winPotential - b.winPotential ||
      symbolRank(a.option) - symbolRank(b.option),
  );
}

export function getHighestWinPotential(
  ladder: readonly WinPotentialOption[],
): number {
  return ladder.reduce((max, entry) => Math.max(max, entry.winPotential), 0);
}

export function getLowestWinPotential(
  ladder: readonly WinPotentialOption[],
): number {
  if (ladder.length === 0) {
    return 0;
  }

  return ladder.reduce(
    (min, entry) => Math.min(min, entry.winPotential),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Selects the symbol the strategy would draw for the supplied ladder.
 * Returns null when nothing should be steered (RANDOM, empty ladder, or no
 * stake anywhere) — the caller must then fall back to a uniform random symbol.
 */
export function selectWinPotentialOption(
  strategy: WinStrategy,
  ladder: readonly WinPotentialOption[],
): WinPotentialOption | null {
  if (strategy === 'RANDOM' || ladder.length === 0) {
    return null;
  }

  const highest = getHighestWinPotential(ladder);
  if (highest <= 0) {
    return null;
  }

  // ladder is sorted ascending; the first match is the lowest symbol on ties.
  const firstWithPotential = (potential: number): WinPotentialOption | null =>
    ladder.find((entry) => entry.winPotential === potential) ?? null;

  if (strategy === 'HIGH') {
    return firstWithPotential(highest);
  }

  const lowest = getLowestWinPotential(ladder);
  if (strategy === 'LOW') {
    return firstWithPotential(lowest);
  }

  const target = (lowest + highest) / 2;

  let best: WinPotentialOption | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of ladder) {
    const distance = Math.abs(entry.winPotential - target);
    if (distance < bestDistance - Number.EPSILON) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

/** Highest / medium / lowest bands, using the exact strategy selection rules. */
export function buildWinPotentialTiers(
  ladder: readonly WinPotentialOption[],
): WinPotentialTiers {
  if (ladder.length === 0) {
    return { highest: [], medium: [], lowest: [] };
  }

  const highest = getHighestWinPotential(ladder);
  const lowest = getLowestWinPotential(ladder);
  const target = (lowest + highest) / 2;
  const mediumCandidate = selectWinPotentialOption('MEDIUM', ladder);

  const medium =
    mediumCandidate === null
      ? []
      : ladder
          .filter(
            (entry) =>
              Math.abs(
                Math.abs(entry.winPotential - target) -
                  Math.abs(mediumCandidate.winPotential - target),
              ) <= Number.EPSILON,
          )
          .map((entry) => entry.option);

  return {
    highest: ladder
      .filter((entry) => entry.winPotential === highest)
      .map((entry) => entry.option),
    medium,
    lowest: ladder
      .filter((entry) => entry.winPotential === lowest)
      .map((entry) => entry.option),
  };
}