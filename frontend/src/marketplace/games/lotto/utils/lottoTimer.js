// src/marketplace/games/lotto/utils/lottoTimer.js
// Server-authoritative Lotto round timer helpers.
//
// SOURCE OF TRUTH: the active round's backend timestamps — never a locally
// restarted countdown. All helpers are pure and accept an injectable `now`
// (epoch ms) so they can be unit-tested deterministically.

import { normalizeRoundStatus } from './lottoState.js';

// ---------------------------------------------------------------------------
// Category duration map (backend contract: THIRTY_SEC | ONE_MIN | THREE_MIN |
// FIVE_MIN). NOTE: backend has no 2-minute category.
// ---------------------------------------------------------------------------

/**
 * Canonical duration (seconds) per backend category.
 * @type {Record<string, number>}
 */
export const CATEGORY_DURATION_SECONDS = {
  THIRTY_SEC: 30,
  ONE_MIN: 60,
  THREE_MIN: 180,
  FIVE_MIN: 300,
};

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

/**
 * Parses a backend ISO timestamp to epoch ms, or null when invalid.
 * @param {string|null|undefined} iso
 * @returns {number|null}
 */
export const toEpochMs = (iso) => {
  if (typeof iso !== 'string' || !iso.trim()) {
    return null;
  }
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
};

// ---------------------------------------------------------------------------
// Core remaining-time calculation (the single source of truth)
// ---------------------------------------------------------------------------

/**
 * Whole seconds until the round's draw time, derived from backend
 * timestamps. Rounds up so a 0.4s remainder still displays 00:01, and
 * clamps to 0 so the value can never be negative.
 *
 *   remainingMs = drawAt - now
 *   remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
 *
 * @param {object|null} round — normalized round (must expose drawAt)
 * @param {number} nowMs — current epoch ms (defaults to Date.now())
 * @returns {number} whole seconds, >= 0
 */
export const computeRemainingSeconds = (round, nowMs = Date.now()) => {
  const drawAtMs = toEpochMs(round?.drawAt);
  if (drawAtMs === null) {
    return 0;
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const remainingMs = drawAtMs - now;
  if (remainingMs <= 0) {
    return 0;
  }

  return Math.max(0, Math.ceil(remainingMs / 1000));
};

// ---------------------------------------------------------------------------
// Round duration
// ---------------------------------------------------------------------------

/**
 * Full round duration in seconds, determined from the backend round
 * contract. Resolution order:
 *
 *   1. round.durationSeconds (if backend exposes it — use as-is)
 *   2. derived: drawAt - startAt (real round timestamps)
 *   3. fallback: category duration map
 *   4. 30 (THIRTY_SEC) as a last resort
 *
 * @param {object|null} round
 * @returns {number} duration in whole seconds, > 0
 */
export const getRoundDurationSeconds = (round) => {
  const explicit = Number(round?.durationSeconds);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }

  const startMs = toEpochMs(round?.startAt);
  const drawMs = toEpochMs(round?.drawAt);
  if (startMs !== null && drawMs !== null && drawMs > startMs) {
    const derived = Math.round((drawMs - startMs) / 1000);
    if (derived > 0) {
      return derived;
    }
  }

  const category = String(round?.category ?? '').trim().toUpperCase();
  return CATEGORY_DURATION_SECONDS[category] ?? 30;
};

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw category to a valid backend value, or null.
 * @param {string|null|undefined} category
 * @returns {string|null}
 */
export const normalizeCategory = (category) => {
  const normalized = String(category ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(
    CATEGORY_DURATION_SECONDS,
    normalized,
  )
    ? normalized
    : null;
};

/**
 * Duration for a category selector value, independent of any round object.
 * @param {string|null|undefined} category
 * @returns {number}
 */
export const getCategoryDurationSeconds = (category) => {
  const normalized = normalizeCategory(category);
  return normalized ? CATEGORY_DURATION_SECONDS[normalized] : 30;
};

// ---------------------------------------------------------------------------
// Server clock offset
// ---------------------------------------------------------------------------

/**
 * Client/server clock offset in ms. Uses the backend serverNow when the
 * API exposes it; otherwise 0 (Date.now() stays authoritative, with
 * active-round polling correcting any drift).
 *
 *   serverOffset = serverNow - Date.now()
 *
 * @param {number|null|undefined} serverNowMs
 * @param {number} [clientNowMs]
 * @returns {number} offset ms to add to Date.now()
 */
export const toServerOffset = (serverNowMs, clientNowMs = Date.now()) => {
  const server = serverNowMs ?? null;
  const client = clientNowMs ?? null;
  if (server === null || client === null) {
    return 0;
  }
  const serverNumeric = Number(server);
  const clientNumeric = Number(client);
  if (!Number.isFinite(serverNumeric) || !Number.isFinite(clientNumeric)) {
    return 0;
  }
  return serverNumeric - clientNumeric;
};
// ---------------------------------------------------------------------------
// Round phases (controlled state machine)
//
//   IDLE → COUNTDOWN → DRAWING → AWAITING_NEXT → (new round) COUNTDOWN
//
// ---------------------------------------------------------------------------

export const TIMER_PHASE = {
  IDLE: 'IDLE', // no active round from backend yet
  COUNTDOWN: 'COUNTDOWN', // round OPEN with drawAt in the future
  DRAWING: 'DRAWING', // round expired or backend locked the round
  AWAITING_NEXT: 'AWAITING_NEXT', // expired, waiting for backend next round
};

const DRAWING_STATUSES = new Set(['CUTOFF', 'DRAWING', 'RESULTED', 'SETTLED']);

/**
 * Derives the canonical timer phase for a round. Round change detection is
 * always by round id (previousRound.id !== newRound.id), never by timer==0.
 *
 * @param {object|null} round
 * @param {number} [nowMs]
 * @returns {string} TIMER_PHASE.*
 */
export const deriveTimerPhase = (round, nowMs = Date.now()) => {
  if (!round || !round.id) {
    return TIMER_PHASE.IDLE;
  }

  const status = normalizeRoundStatus(round.status);
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'REFUNDED') {
    return TIMER_PHASE.AWAITING_NEXT;
  }

  if (DRAWING_STATUSES.has(status)) {
    return TIMER_PHASE.DRAWING;
  }

  const remaining = computeRemainingSeconds(round, nowMs);
  return remaining > 0 ? TIMER_PHASE.COUNTDOWN : TIMER_PHASE.DRAWING;
};

/**
 * True when the round has actually expired (draw time passed) and the UI
 * should treat it as completed — independent of the display countdown.
 * @param {object|null} round
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export const isRoundExpired = (round, nowMs = Date.now()) => {
  const drawAtMs = toEpochMs(round?.drawAt);
  if (drawAtMs === null) {
    return false;
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now >= drawAtMs;
};

/**
 * True when a new round should trigger a timer restart: the round id must
 * actually differ. Guards against stale refreshes re-triggering transitions
 * for the same round.
 *
 * @param {object|null} previousRound
 * @param {object|null} nextRound
 * @returns {boolean}
 */
export const isNewRound = (previousRound, nextRound) => {
  const previousId = previousRound?.id ?? null;
  const nextId = nextRound?.id ?? null;
  return previousId !== null && nextId !== null && previousId !== nextId;
};

// ---------------------------------------------------------------------------
// Cutoff / pre-reveal window
// ---------------------------------------------------------------------------

/**
 * Length of the pre-reveal window in seconds. Mirrors the backend's
 * LOTTO_TICKET_CUTOFF_SECONDS: in this window betting is closed AND the result
 * for the round is already pre-computed server-side, so the client may cache it
 * and reveal it at drawAt with no API call.
 */
export const RESULT_PRE_REVEAL_SECONDS = 5;

/**
 * True while the round sits in its cutoff window: `[cutoffAt, drawAt)`.
 *
 * Prefers the round's OWN backend `cutoffAt` (the authoritative boundary the
 * server uses to reject tickets) and falls back to the last
 * RESULT_PRE_REVEAL_SECONDS before drawAt when the field is missing.
 *
 * @param {object|null} round
 * @param {number} nowMs — server-synchronized now (epoch ms)
 * @returns {boolean}
 */
export const isInCutoffWindow = (round, nowMs) => {
  const drawAtMs = toEpochMs(round?.drawAt);
  if (drawAtMs === null) {
    return false;
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (now >= drawAtMs) {
    return false;
  }

  const cutoffAtMs = toEpochMs(round?.cutoffAt);
  if (cutoffAtMs !== null) {
    return now >= cutoffAtMs;
  }

  return drawAtMs - now <= RESULT_PRE_REVEAL_SECONDS * 1000;
};