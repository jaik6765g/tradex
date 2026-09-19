// ============================================================
// frontend/src/trade/pulse/utils/pulseResultCard.ts
// ============================================================
// Pure, testable resolver for the Pulse Trade settlement popup.
//
// REQUIRED MAPPING (final backend settlement result only):
//   1. LONG  + WIN  -> UP card   + GREEN
//   2. LONG  + LOSS -> DOWN card + RED
//   3. SHORT + WIN  -> DOWN card + GREEN
//   4. SHORT + LOSS -> UP card   + RED
//
// Rationale: the card shows PRICE MOVEMENT implied by the settled
// trade, not the raw direction:
//   - LONG wins when price went UP; loses when price went DOWN.
//   - SHORT wins when price went DOWN; loses when price went UP.
// Color always follows the OUTCOME (WIN = GREEN, LOSS = RED) while
// the artwork follows the movement (UP vs DOWN asset).
//
// DRAW (or unknown/missing data) never resolves to WIN/LOSS.
// Unknown direction + WIN/LOSS keeps the outcome colour but falls
// back to a neutral card so no wrong UP/DOWN artwork is shown.
// ============================================================

export type PulseResultCardDirection = 'UP' | 'DOWN';
export type PulseResultCardTone = 'GREEN' | 'RED' | 'NEUTRAL';

export interface PulseResultCardResolution {
  /** Price-movement card to render, or null when no card applies. */
  card: PulseResultCardDirection | null;
  /** Colour state for the card. */
  tone: PulseResultCardTone;
  /** True only for finalized WIN/LOSS outcomes. */
  isWinLoss: boolean;
}

export type PulseDirectionInput = string | null | undefined;
export type PulseOutcomeInput = string | null | undefined;

type NormalizedDirection = 'LONG' | 'SHORT' | null;
type NormalizedOutcome = 'WIN' | 'LOSS' | 'DRAW' | null;

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? '').trim().toUpperCase();

/** Safely normalizes direction. Only LONG/SHORT resolve; else null. */
export function normalizePulseDirection(
  direction: PulseDirectionInput,
): NormalizedDirection {
  const normalized = normalizeText(direction);
  if (normalized === 'LONG') return 'LONG';
  if (normalized === 'SHORT') return 'SHORT';
  return null;
}

/**
 * Safely normalizes the FINALIZED backend settlement outcome.
 * Accepts backend enums (WIN/LOSS/DRAW) plus legacy history aliases
 * (WON/LOST). Anything else (OPEN/SETTLING/SETTLED/empty/garbage)
 * resolves to null so callers never show a wrong WIN/LOSS card.
 */
export function normalizePulseOutcome(
  outcome: PulseOutcomeInput,
): NormalizedOutcome {
  const normalized = normalizeText(outcome);
  if (normalized === 'WIN' || normalized === 'WON') return 'WIN';
  if (normalized === 'LOSS' || normalized === 'LOST') return 'LOSS';
  if (normalized === 'DRAW') return 'DRAW';
  return null;
}

export interface ResolvePulseResultCardInput {
  direction: PulseDirectionInput;
  /** Finalized backend settlement result (trade.result). */
  outcome: PulseOutcomeInput;
}

/**
 * Pure resolver: direction + finalized outcome -> card + tone.
 * No I/O, no React, no guessing from animations/prices.
 */
export function resolvePulseResultCard({
  direction,
  outcome,
}: ResolvePulseResultCardInput): PulseResultCardResolution {
  const normalizedDirection = normalizePulseDirection(direction);
  const normalizedOutcome = normalizePulseOutcome(outcome);

  if (normalizedOutcome === 'WIN') {
    if (normalizedDirection === 'LONG') {
      return { card: 'UP', tone: 'GREEN', isWinLoss: true };
    }
    if (normalizedDirection === 'SHORT') {
      return { card: 'DOWN', tone: 'GREEN', isWinLoss: true };
    }
    // Known WIN but unknown direction: keep GREEN, no movement card.
    return { card: null, tone: 'GREEN', isWinLoss: true };
  }

  if (normalizedOutcome === 'LOSS') {
    if (normalizedDirection === 'LONG') {
      return { card: 'DOWN', tone: 'RED', isWinLoss: true };
    }
    if (normalizedDirection === 'SHORT') {
      return { card: 'UP', tone: 'RED', isWinLoss: true };
    }
    // Known LOSS but unknown direction: keep RED, no movement card.
    return { card: null, tone: 'RED', isWinLoss: true };
  }

  // DRAW or unknown/missing outcome: neutral, never WIN/LOSS.
  return { card: null, tone: 'NEUTRAL', isWinLoss: false };
}

// ------------------------------------------------------------
// CARD COLOUR STATE (GREEN win / RED loss)
// ------------------------------------------------------------
// Mirrors the Lotto settlement card styling: the light-blue
// up.png / down.webp frame art is tinted with a CSS hue-rotate so
// the WHOLE card (ribbon, artwork, receipt) reads GREEN on a win
// and RED on a loss. Kept pure + dependency-free so it can be
// unit tested without a DOM.
// ------------------------------------------------------------

export interface PulseResultToneStyle {
  /** CSS filter that tints the light-blue frame asset. */
  frameFilter: string;
  /** Accent colour for the settlement amount + confirm glyph. */
  accent: string;
  /** Solid chip background for the WIN / LOSS badge. */
  chip: string;
  /** True for the winning (GREEN) state. */
  isWin: boolean;
}

const GREEN_TONE_STYLE: PulseResultToneStyle = {
  // Light blue (~hue 215deg) -75deg -> green, same trick Lotto uses.
  frameFilter: 'hue-rotate(-75deg) saturate(1.6) brightness(1.02)',
  accent: '#16A34A',
  chip: '#22C55E',
  isWin: true,
};

const RED_TONE_STYLE: PulseResultToneStyle = {
  // Light blue (~hue 215deg) +140deg -> red.
  frameFilter: 'hue-rotate(140deg) saturate(1.7) brightness(1.02)',
  accent: '#E5484D',
  chip: '#EF4444',
  isWin: false,
};

const NEUTRAL_TONE_STYLE: PulseResultToneStyle = {
  frameFilter: 'none',
  accent: '#FF7A18',
  chip: '#FF8F3D',
  isWin: false,
};

/**
 * Pure tone -> style resolver. Unknown/blank tone safely falls back
 * to the neutral (DRAW) styling, never to a WIN state.
 */
export function resolvePulseResultToneStyle(
  tone: string | null | undefined,
): PulseResultToneStyle {
  const normalized = normalizeText(tone);
  if (normalized === 'GREEN') return GREEN_TONE_STYLE;
  if (normalized === 'RED') return RED_TONE_STYLE;
  return NEUTRAL_TONE_STYLE;
}

export interface PriceMovementInput {
  entryPrice: string | number | null | undefined;
  exitPrice: string | number | null | undefined;
}

/**
 * Optional helper: derives UP/DOWN movement purely from settled
 * entry/exit prices. Equal or unparseable prices -> null (no card).
 * Useful for tests/cross-checks; the popup itself still uses the
 * backend `result` via resolvePulseResultCard.
 */
export function resolvePriceMovement({
  entryPrice,
  exitPrice,
}: PriceMovementInput): PulseResultCardDirection | null {
  // NB: Number(null) and Number('') both coerce to 0 — treat
  // missing/blank inputs as unknown BEFORE numeric coercion.
  if (entryPrice === null || entryPrice === undefined) return null;
  if (exitPrice === null || exitPrice === undefined) return null;
  if (typeof entryPrice === 'string' && entryPrice.trim() === '') return null;
  if (typeof exitPrice === 'string' && exitPrice.trim() === '') return null;
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  if (entry <= 0 || exit <= 0) return null;
  if (exit > entry) return 'UP';
  if (exit < entry) return 'DOWN';
  return null;
}
