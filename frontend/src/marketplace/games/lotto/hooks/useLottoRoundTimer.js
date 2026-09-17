// src/marketplace/games/lotto/hooks/useLottoRoundTimer.js
// Canonical Lotto round timer — THE single source of truth for the
// countdown and round-completion flow.
//
// Rules enforced here (see task spec):
// - Remaining time is ALWAYS derived from the active round's backend
//   `drawAt` timestamp. It is never seeded from a duration and never
//   decremented independently, so it cannot drift or reset artificially.
// - Completion fires exactly ONCE per round id (guarded by
//   completedForRoundRef), and only one transition can be in flight at a
//   time (transitionInFlightRef) — no duplicate refreshes/wallet calls.
// - When the round expires we enter DRAWING, refresh the backend active
//   round via onComplete, and only return to COUNTDOWN when a NEW round id
//   arrives (round change is detected by id, never by timer === 0).
// - If the backend is slow to return the next round, the UI parks in
//   AWAITING_NEXT ("Loading next round…") instead of restarting the old
//   timer. Retries are allowed from that state (visibility / poll).
// - Tab visibility changes immediately recalculate from backend timestamps.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TIMER_PHASE,
  computeRemainingSeconds,
  deriveTimerPhase,
  isRoundExpired,
} from '../utils/lottoTimer';

// Display tick — pure UI smoothing. Round timing itself always comes from
// the backend drawAt timestamp, so tick frequency cannot cause drift.
const DISPLAY_TICK_MS = 500;

export const useLottoRoundTimer = ({ round, onComplete, getNow, onSecondTick }) => {
  const roundId = round?.id ?? null;
  const drawAt = round?.drawAt ?? null;

  // Server-synchronized clock (falls back to the local clock). Stored in a ref
  // so it stays stable across renders while always reading the latest value.
  const getNowRef = useRef(typeof getNow === 'function' ? getNow : () => Date.now());
  getNowRef.current = typeof getNow === 'function' ? getNow : () => Date.now();
  const now = useCallback(() => getNowRef.current(), []);

  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    computeRemainingSeconds(round, now()),
  );
  const [phase, setPhase] = useState(() => deriveTimerPhase(round, now()));

  // Latest values for interval/visibility handlers without re-subscribing.
  const roundRef = useRef(round);
  roundRef.current = round;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // §11 — completion guards: one completion per round id, one in-flight
  // transition at a time.
  const completedForRoundRef = useRef(null);
  const transitionInFlightRef = useRef(false);
  // Tracks the last whole-second we fired onSecondTick for, so 500ms display
  // ticks never double-invoke the per-second callback (sound/animation sync).
  const lastSecondTickRef = useRef(null);

  const recompute = useCallback(() => {
    setRemainingSeconds(computeRemainingSeconds(roundRef.current, now()));
  }, [now]);

  /**
   * Round completion flow (runs at most once concurrently):
   *   DRAWING → onComplete (refresh active round + results + tickets +
   *   balance) → COUNTDOWN when a new round arrived, or AWAITING_NEXT when
   *   the backend is still returning the expired round.
   */
  const beginTransition = useCallback(async () => {
    const currentRound = roundRef.current;
    const currentRoundId = currentRound?.id ?? null;
    if (!currentRoundId) {
      return;
    }

    // Single-flight guard — never start a second transition while one is
    // running (prevents duplicate API calls / wallet refreshes).
    if (transitionInFlightRef.current) {
      return;
    }

    // One completion per round id. While AWAITING_NEXT a retry is allowed
    // (user returned to the tab, or the poll has not produced a new round).
    if (
      completedForRoundRef.current === currentRoundId &&
      phaseRef.current !== TIMER_PHASE.AWAITING_NEXT
    ) {
      return;
    }

    completedForRoundRef.current = currentRoundId;
    transitionInFlightRef.current = true;
    setPhase(TIMER_PHASE.DRAWING);

    let refreshedOk = true;
    try {
      await onCompleteRef.current?.();
    } catch {
      // onComplete implementations swallow API errors, but stay defensive:
      // a failed refresh parks us in AWAITING_NEXT so it can be retried.
      refreshedOk = false;
    } finally {
      transitionInFlightRef.current = false;
    }

    // The round changed while we awaited (new round detected by id) — the
    // round-change effect below has already reset state; do not clobber it.
    if (completedForRoundRef.current !== currentRoundId) {
      return;
    }

    const stillExpired = isRoundExpired(roundRef.current, now());
    setPhase(
      stillExpired || !refreshedOk
        ? TIMER_PHASE.AWAITING_NEXT
        : TIMER_PHASE.COUNTDOWN,
    );
  }, []);

  // ------------------------------------------------------------------
  // Round lifecycle effect — keyed on the round IDENTITY (id + drawAt).
  // A genuinely new round (different id or corrected drawAt) resets the
  // completion guards and restarts exactly one countdown, seeded purely
  // from the new backend drawAt.
  // ------------------------------------------------------------------
  useEffect(() => {
    completedForRoundRef.current = null;
    lastSecondTickRef.current = null;

    const initialPhase = deriveTimerPhase(round, now());
    const initialRemaining = computeRemainingSeconds(round, now());
    setPhase(initialPhase);
    setRemainingSeconds(initialRemaining);

    if (initialPhase === TIMER_PHASE.IDLE) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const currentRound = roundRef.current;
      const currentNow = now();
      const next = computeRemainingSeconds(currentRound, currentNow);

      setRemainingSeconds(next);
      if (onSecondTick && lastSecondTickRef.current !== next) {
        lastSecondTickRef.current = next;
        onSecondTick(next);
      }
      if (next <= 0) {
        void beginTransition();
      }
    }, DISPLAY_TICK_MS);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, drawAt, beginTransition, now]);

  // ------------------------------------------------------------------
  // Tab visibility — recalculate immediately from backend timestamps and
  // trigger the completion flow if the round expired while hidden.
  // ------------------------------------------------------------------
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        typeof document === 'undefined' ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      recompute();

      if (
        isRoundExpired(roundRef.current, now()) ||
        phaseRef.current === TIMER_PHASE.AWAITING_NEXT
      ) {
        void beginTransition();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [beginTransition, recompute, now]);

  // Server-synchronized remaining time in ms, derived from the authoritative
  // period end timestamp. Lets the UI show a smooth, drift-free countdown that
  // survives refresh / tab-switch / lag and never invents a period.
  const drawAtMs = (() => {
    const iso = round?.drawAt ?? null;
    if (typeof iso !== "string" || !iso.trim()) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
  })();
  const serverRemainingMs = drawAtMs == null ? 0 : Math.max(0, drawAtMs - now());

  return {
    remainingSeconds,
    serverRemainingMs,
    phase,
    isExpiring: remainingSeconds > 0 && remainingSeconds <= 5,
  };
};

export default useLottoRoundTimer;