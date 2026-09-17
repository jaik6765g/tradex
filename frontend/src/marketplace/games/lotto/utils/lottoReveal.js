// src/marketplace/games/lotto/utils/lottoReveal.js
// Pure reveal helpers — the single decision point for "may this prepared result
// be shown yet?" and for merging it into the visible ball row.
//
// All functions are pure and take an injectable `now` (server-synchronized epoch
// ms), so the reveal timing can be verified deterministically without a DOM,
// a network call or a real clock.

import { toEpochMs } from './lottoTimer.js';

/**
 * True for a single valid Lotto symbol (0-9, A-F).
 * @param {unknown} value
 * @returns {boolean}
 */
export const isValidResultSymbol = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  return /^[0-9A-F]$/.test(value.trim().toUpperCase());
};

/**
 * Decides whether the prepared (pre-computed) value may be revealed RIGHT NOW,
 * and builds the UI-ready result item when it may.
 *
 * Returns null — i.e. "keep showing the previous state" — when:
 *   - there is no active round / no prepared value for THIS round;
 *   - this round was already revealed (exactly-once guarantee);
 *   - the authoritative reveal instant has not been reached yet (server time);
 *   - the prepared value is not a valid symbol.
 *
 * Never returns two different values for the same round: the caller must pass
 * its already-revealed set, and must record the round id on success.
 *
 * @param {object} params
 * @param {object|null} params.prepared — { roundId, result, revealAt?, ... }
 * @param {object|null} params.round — active round (needs id, drawAt fallback)
 * @param {number} params.nowMs — server-synchronized now (epoch ms)
 * @param {Set<number|string>} [params.revealedRoundIds]
 * @returns {object|null} UI-ready result item, or null
 */
export const resolvePreparedReveal = ({
  prepared,
  round,
  nowMs,
  revealedRoundIds,
}) => {
  const roundId = round?.id ?? null;
  if (!roundId) {
    return null;
  }

  if (revealedRoundIds && typeof revealedRoundIds.has === 'function' && revealedRoundIds.has(roundId)) {
    return null;
  }

  if (!prepared || prepared.roundId !== roundId) {
    return null;
  }

  // The round's own drawAt is the authoritative instant a value becomes public;
  // the backend also sends it explicitly as `revealAt`.
  const revealAtMs = toEpochMs(prepared.revealAt) ?? toEpochMs(round.drawAt);
  if (revealAtMs === null) {
    return null;
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (now < revealAtMs) {
    return null; // never reveal early
  }

  if (!isValidResultSymbol(prepared.result)) {
    return null;
  }

  return {
    id: prepared.id ?? null,
    roundId,
    roundNumber: prepared.roundNumber ?? round?.roundNumber ?? null,
    category: prepared.category ?? round?.category ?? null,
    status: 'RESULTED',
    result: String(prepared.result).trim().toUpperCase(),
    resultSource: prepared.resultSource ?? null,
    revealAt: prepared.revealAt ?? null,
    drawAt: prepared.drawAt ?? round?.drawAt ?? null,
  };
};

/**
 * Merges the just-revealed value into the visible result list, PINNED as the
 * newest entry.
 *
 * The backend list is normally a moment behind at 00:00, so the revealed value
 * must lead the row — and must never be pushed out or replaced by that older
 * list (dedup by roundId / roundNumber once the list catches up).
 *
 * @param {Array} results — recent results (may be stale / may not include it)
 * @param {object|null} revealed — item from resolvePreparedReveal()
 * @param {string} [category] — active category (a reveal must not leak across tabs)
 * @returns {Array}
 */
export const mergeRevealedResult = (results, revealed, category) => {
  const base = Array.isArray(results) ? results : [];

  if (!revealed) {
    return base;
  }

  if (category && revealed.category && revealed.category !== category) {
    return base;
  }

  const isSameRound = (item) => {
    const sameId =
      revealed.roundId != null
      && item?.roundId != null
      && String(item.roundId) === String(revealed.roundId);
    const sameNumber =
      revealed.roundNumber != null
      && item?.roundNumber != null
      && String(item.roundNumber) === String(revealed.roundNumber);

    return sameId || sameNumber;
  };

  return [revealed, ...base.filter((item) => !isSameRound(item))];
};
