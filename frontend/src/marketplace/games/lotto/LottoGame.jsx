// src/marketplace/games/lotto/LottoGame.jsx
// Premium Lotto experience. Composition layer only — all game state lives
// in useLottoGame (polling, idempotency, wallet refresh) and all timer
// state lives in useLottoRoundTimer (server-authoritative countdown from
// the active round's backend drawAt, with a guarded completion flow).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import LottoHeader from './components/LottoHeader';
import LottoPeriodTimer from './components/LottoPeriodTimer';
import LottoNumberGrid from './components/LottoNumberGrid';
import LottoHistoryTabs from './components/LottoHistoryTabs';
import CountdownOverlay from './components/CountdownOverlay';
import LottoBuyCard from './components/LottoBuyCard';


import WinLossPopup from '../../../shared/components/WinLossPopup';

import { useLottoGame } from './hooks/useLottoGame';
import { useLottoRoundTimer } from './hooks/useLottoRoundTimer';
import { useCountdownSound } from './hooks/useCountdownSound';
import { useResultSound } from './hooks/useResultSound';
import { LOTTO_CONSTANTS, CATEGORY_DURATION_SECONDS } from './utils/constants';
import { isRoundOpenForPurchase } from './utils/lottoState';
import {
  TIMER_PHASE,
  isNewRound,
  isInCutoffWindow,
  toEpochMs,
} from './utils/lottoTimer';
import { resolvePreparedReveal } from './utils/lottoReveal';

import './LottoPremium.css';

export default function LottoGame({ onBack } = {}) {
  // Per-ticket selection: har Buy Card ek alag ticket hai. Card close/confirm
  // par memory wipe hoti hai taaki agla quick selector pehle wale ticket se
  // block na ho (period same ho tab bhi sab betable rahen).
  const [selected, setSelected] = useState([]);
  const [selectionError, setSelectionError] = useState(null);
  // TPPlay direct flow: click ANY betting selection -> LottoBuyCard opens immediately.
  // No intermediate "Buy Ticket" CTA. Single shared buy-selection for numbers + colors.
  // Every confirmed/closed Buy Card is a separate, independent ticket: the
  // selection memory is wiped on close so all 4 quick selectors stay bettable
  // for the next ticket in the SAME period (no stale forbiddenGroup lock).
  const [buyCardOpen, setBuyCardOpen] = useState(false);
  const [buySelection, setBuySelection] = useState(null);

  const {
    loading,
    placingBet,
    balance,
    activeRound,
    category,
    recentResults,
    resultsLoading,
    resultsMeta,
    pendingResult,
    fetchPendingResult,
    history,
    historyMeta,
    historyLoading,
    controls,
    error,
    latestTicket,
    settlementPopup,
    dismissSettlementPopup,
    placeBet,
    refreshLottoState,
    selectCategory,
    getHistory,
    getLastResult,
    isAuthenticated,
    getServerNow,
    getActiveRound,
  } = useLottoGame();

  // Header mirrors the exact tapped option: "Select 7", "Select A", "Select Green".
  const buyCardSelectionLabel = useMemo(() => {
    if (!buySelection) return 'Select';
    if (buySelection.kind === 'number') return `Select ${buySelection.value}`;
    const name = String(buySelection.value || '');
    return `Select ${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()}`;
  }, [buySelection]);

  const buyCardGameTitle = useMemo(() => {
    const seconds = CATEGORY_DURATION_SECONDS[category];
    if (Number.isFinite(seconds)) return `Lotto ${seconds}sec`;
    return 'Lotto';
  }, [category]);

  // ------------------------------------------------------------------
  // RESULT REVEAL PIPELINE — prepared early, revealed at 00, zero delay.
  //
  // 1) CUTOFF WINDOW (last CUTOFF_SECONDS of the period): betting is already
  //    closed (isLocked) and the backend has PRE-COMPUTED this round's result.
  //    We fetch + cache that value here, BEFORE zero, so nothing has to be
  //    requested when the countdown ends.
  // 2) AT 00: the cached value is published the instant server time reaches the
  //    round's drawAt — one precise, server-time-armed trigger plus a passive
  //    fallback. No API call, no extra wait after zero, no animation gate.
  // 3) AFTER 00: background refreshes only reconcile history/tickets/balance
  //    (WIN/LOSS popup). They can never overwrite or delay the revealed ball.
  //
  // Race/duplicate protection:
  //   - revealedRoundIdsRef → exactly ONE reveal per round id;
  //   - the value is gated on revealAt, so it can never be shown early;
  //   - a newer reveal always wins and an older result can never replace it
  //     (LottoPeriodTimer pins the revealed value as the newest ball).
  // ------------------------------------------------------------------
  const revealedRoundIdsRef = useRef(new Set());
  const preparedValueRef = useRef(null); // { roundId, result, revealAt, ... }
  const activeRoundLocalRef = useRef(activeRound);
  activeRoundLocalRef.current = activeRound;
  // getServerNow is recreated on every hook render — keep it in a ref so the
  // reveal effects below do not re-subscribe on every render.
  const getServerNowRef = useRef(getServerNow);
  getServerNowRef.current = getServerNow;

  // The value to show at 00 — set ONLY by revealPreparedResult().
  const [revealedResult, setRevealedResult] = useState(null);

  // Keep the hook's pre-reveal cache in a ref for the reveal path (no fetch).
  useEffect(() => {
    const prepared = pendingResult;
    if (!prepared || prepared.roundId == null) return;
    if (activeRoundLocalRef.current?.id !== prepared.roundId) return;
    preparedValueRef.current = prepared;
  }, [pendingResult]);

  // Publishes the prepared value — the SOLE writer of revealedResult, single
  // fire per round id, hard-gated on the authoritative reveal instant.
  // All the decision logic lives in the pure resolvePreparedReveal() helper.
  const revealPreparedResult = useCallback(() => {
    const round = activeRoundLocalRef.current;
    const roundId = round?.id ?? null;
    if (!roundId) return false;

    const item = resolvePreparedReveal({
      prepared: preparedValueRef.current,
      round,
      nowMs: getServerNowRef.current(),
      revealedRoundIds: revealedRoundIdsRef.current,
    });

    if (!item) return false;

    // Record FIRST, then publish: a re-entrant call (timer fire + render
    // fallback in the same tick) can never produce a second reveal.
    revealedRoundIdsRef.current.add(roundId);
    preparedValueRef.current = null;
    setRevealedResult(item);
    return true;
  }, []);

  // Round completion: the revealed ball is ALREADY on screen, so this only
  // reconciles backend state — and it is deliberately not awaited by the
  // reveal path, so the countdown never waits for the network.
  const handleRoundExpire = useCallback(() => {
    const endedRoundNumber = String(activeRoundLocalRef.current?.roundNumber ?? '');

    void refreshLottoState();

    // Tickets settle shortly AFTER the draw, so a short bounded catch-up keeps
    // the WIN/LOSS popup timely. Purely background: it never blocks or delays
    // the 00:00 reveal.
    void (async () => {
      const SETTLE_STATUSES = ['WIN', 'LOSS', 'SETTLED', 'REFUNDED', 'CANCELLED'];
      const MAX_ATTEMPTS = 4;
      const RETRY_MS = 700;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS));

        const [items, tickets] = await Promise.all([
          getLastResult({ limit: 5, offset: 0, append: false }),
          getHistory({ limit: 5, offset: 0, append: false }),
        ]);

        const topRoundNumber = String(
          Array.isArray(items) && items.length > 0 ? items[0]?.roundNumber ?? '' : '',
        );
        const newestTicketStatus = String(
          Array.isArray(tickets) && tickets.length > 0 ? tickets[0]?.status ?? '' : '',
        ).toUpperCase();
        const settled = SETTLE_STATUSES.includes(newestTicketStatus);

        // Period numbers are fixed-width numeric strings, so a string compare is
        // order-safe. Stop once BOTH the draw AND the settlement have arrived.
        if (
          endedRoundNumber
          && topRoundNumber
          && topRoundNumber >= endedRoundNumber
          && settled
        ) {
          break;
        }
      }
    })();
  }, [refreshLottoState, getLastResult, getHistory]);

  const roundTimer = useLottoRoundTimer({
    round: activeRound,
    onComplete: handleRoundExpire,
    getNow: getServerNow,
  });

  // --- Step 1: cache the prepared value during the cutoff window ------------
  // Re-runs on every whole-second tick, so at most one request per second and
  // at most CUTOFF_SECONDS requests per round — and ZERO requests at 00.
  useEffect(() => {
    const round = activeRound;
    if (!round?.id) return;
    if (revealedRoundIdsRef.current.has(round.id)) return;
    if (preparedValueRef.current?.roundId === round.id) return;
    if (!isInCutoffWindow(round, getServerNowRef.current())) return;

    void fetchPendingResult();
  }, [
    activeRound?.id,
    activeRound?.roundNumber,
    activeRound?.drawAt,
    roundTimer.remainingSeconds,
    fetchPendingResult,
  ]);

  // --- Step 2a: precise reveal trigger, armed at the reveal instant ---------
  // Fires at (revealAt - serverNow), i.e. AT 00:00 — not after it.
  useEffect(() => {
    const prepared = pendingResult;
    const round = activeRound;
    if (!prepared || !round?.id) return undefined;
    if (prepared.roundId !== round.id) return undefined;
    if (revealedRoundIdsRef.current.has(round.id)) return undefined;

    const revealAtMs = toEpochMs(prepared.revealAt) ?? toEpochMs(round.drawAt);
    if (revealAtMs === null) return undefined;

    const delayMs = revealAtMs - getServerNowRef.current();
    if (delayMs <= 0) {
      revealPreparedResult();
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      revealPreparedResult();
    }, delayMs);

    return () => window.clearTimeout(timerId);
  }, [pendingResult, activeRound?.id, activeRound?.drawAt, revealPreparedResult]);

  // --- Step 2b: passive fallback --------------------------------------------
  // Covers throttled/background timers, tab wake-ups and a missed fire: as soon
  // as ANY render happens at/after the reveal instant the value is published.
  // Same single-fire guard, so a double reveal is impossible.
  useEffect(() => {
    revealPreparedResult();
  });

  // Switching duration tab must never carry a reveal (or a prepared value)
  // across categories.
  useEffect(() => {
    revealedRoundIdsRef.current = new Set();
    preparedValueRef.current = null;
    setRevealedResult(null);
  }, [category]);

  // Countdown sound: plays countdown.mp3 once per second at 5..1.
  // Lives below roundTimer so it can read the authoritative remainingSeconds/phase.
  const { muted, toggleMute } = useCountdownSound(roundTimer.remainingSeconds, { phase: roundTimer.phase });

  // Result reveal sound: playResult() resolves ONLY after result.mp3 fully
  // finishes (onended). The sound starts AT 00 (countdown zero) — NOT when the
  // backend settlement data later arrives — and the Win/Loss popup is shown
  // only after the sound has completely finished.
  const { playResult } = useResultSound({ muted });

  const [settlementDisplay, setSettlementDisplay] = useState(null);
  const lastSettlementIdRef = useRef(null);
  const pendingSettlementRef = useRef(null); // settlement waiting to be shown
  const resultPlayedForRoundRef = useRef(false); // sound played once per round
  const resultPlayInFlightRef = useRef(false);   // sound currently mid-play

  const maybeRevealSettlement = () => {
    if (resultPlayInFlightRef.current) return; // wait until the sound ends
    const pending = pendingSettlementRef.current;
    if (!pending || pending.id !== lastSettlementIdRef.current) return;
    pendingSettlementRef.current = null;
    setSettlementDisplay(pending);
  };

  // 1) At 00 → play result.mp3 exactly once per round.
  useEffect(() => {
    if (roundTimer.remainingSeconds === 0 && !resultPlayedForRoundRef.current) {
      resultPlayedForRoundRef.current = true;
      resultPlayInFlightRef.current = true;
      void playResult().finally(() => {
        resultPlayInFlightRef.current = false;
        maybeRevealSettlement();
      });
    }
  }, [roundTimer.remainingSeconds, playResult]);

  // 2) Re-arm the result sound when a fresh (non-expiring) round begins.
  useEffect(() => {
    if (roundTimer.remainingSeconds > 5) {
      resultPlayedForRoundRef.current = false;
    }
  }, [roundTimer.remainingSeconds]);

  // 3) Settlement data arrives → stash it; the popup appears only after the
  //    00 result sound has fully finished (never simultaneously).
  useEffect(() => {
    if (!settlementPopup) {
      lastSettlementIdRef.current = null;
      pendingSettlementRef.current = null;
      setSettlementDisplay(null);
      return;
    }
    if (settlementPopup.id === lastSettlementIdRef.current) return;
    lastSettlementIdRef.current = settlementPopup.id;
    pendingSettlementRef.current = settlementPopup;
    maybeRevealSettlement();
  }, [settlementPopup, playResult]);

  const handleCloseSettlement = () => {
    dismissSettlementPopup();
    setSettlementDisplay(null);
  };

  // Round change detection: previousRound.id !== newRound.id (never
  // timer === 0). The canonical hook restarts its countdown from the new
  // round's backend drawAt automatically; this effect is the explicit
  // detection point for the transition.
  const previousRoundIdRef = useRef(null);
  useEffect(() => {
    const nextRoundId = activeRound?.id ?? null;
    if (isNewRound({ id: previousRoundIdRef.current }, activeRound)) {
      // New active round detected — the canonical hook has already reset
      // its phase to COUNTDOWN seeded from the new round's drawAt.
      previousRoundIdRef.current = nextRoundId;
      return;
    }
    previousRoundIdRef.current = nextRoundId;
  }, [activeRound]);

  // Boundary-driven fast poll: only when round is actually expired or awaiting next.
  // Do NOT poll during normal countdown (5..1) - this prevents timer reset race conditions.
  useEffect(() => {
    const shouldFastPoll =
      roundTimer.phase === TIMER_PHASE.AWAITING_NEXT ||
      (roundTimer.phase === TIMER_PHASE.COUNTDOWN &&
        roundTimer.remainingSeconds === 0);

    if (!shouldFastPoll) {
      return undefined;
    }

    const fastPollId = window.setInterval(() => {
      void getActiveRound();
    }, 1000);

    return () => window.clearInterval(fastPollId);
  }, [roundTimer.phase, roundTimer.remainingSeconds, getActiveRound]);

  const isPaused = controls?.paused || false;
  const isRoundOpen = isRoundOpenForPurchase({
    hasActiveRound: Boolean(activeRound),
    status: activeRound?.status,
    timerDuration: roundTimer.remainingSeconds,
  });
  // HIGH-001 fix: `loading`/`isRefreshing` (background poll activity) must
  // NEVER lock or dim the betting UI. Only a genuine betting lock
  // (bet in flight, paused, unauthenticated, round closed / non-COUNTDOWN
  // phase) may do that. The first blocking load cannot dim the grid anyway:
  // before it completes there is no active round, so `!isRoundOpen` already
  // locks the UI — the grid only becomes interactive once real round data
  // arrives.
  const isLocked =
    placingBet ||
    isPaused ||
    !isAuthenticated ||
    !isRoundOpen ||
    roundTimer.phase !== TIMER_PHASE.COUNTDOWN;

  // Har tap = ek INDEPENDENT ticket. Buy Card open hote hi pichhle ticket ki
  // selection memory yahin wipe ho jaati hai, isliye period same ho tab bhi
  // agla quick selector / ball kabhi block nahin hota. Backend har confirm par
  // alag ticket row banata hai (userId+idempotency unique, userId+roundId sirf
  // index hai) - period same hone par bhi ticket alag-alag hote hain.
  const handleBetSelection = (selection) => {
    if (isLocked) return;
    if (Number(roundTimer?.remainingSeconds) <= LOTTO_CONSTANTS.CUTOFF_SECONDS) return;
    setSelectionError(null);
    if (!selection) return;
    if (selection.kind === 'number') {
      // Fresh ticket: sirf tapped ball, purani memory wipe.
      setSelected([selection.value]);
      setBuySelection({ kind: 'number', value: selection.value });
      setBuyCardOpen(true);
      return;
    }
    if (selection.kind === 'color') {
      // Fresh ticket: sirf TAPPED group ke numbers, grid ki purani memory
      // merge nahin hoti. Isliye ek ticket ke baad doosra selector hamesha
      // kaam karta hai - koi forbidden lock carry-over nahin.
      const groupNumbers = Array.isArray(selection.numbers) ? [...selection.numbers] : [];
      setSelected(groupNumbers);
      setBuySelection({ kind: 'color', value: selection.value });
      setBuyCardOpen(true);
    }
  };

  const handleToggleNumber = (value) => {
    // NUMBER CLICK -> LottoBuyCard opens IMMEDIATELY (no Buy Ticket CTA).
    // Existing highlight kept via setSelected; single shared popup used.
    handleBetSelection({ kind: 'number', value });
  };

  const handleToggleGroup = (groupKey, numbers) => {
    // COLOR/GROUP CLICK -> LottoBuyCard opens IMMEDIATELY (no Buy Ticket CTA).
    // Uses the project's real GREEN/RED/YELLOW/BLUE groups only.
    handleBetSelection({ kind: 'color', value: groupKey, numbers });
  };

  // Card band (cancel/X) par memory wipe: agla tap hamesha fresh ticket kholta hai.
  const handleCloseBuyCard = () => {
    setSelected([]);
    setSelectionError(null);
    setBuySelection(null);
    setBuyCardOpen(false);
  };

  // Betting cutoff: close the Buy Card at the SHARED cutoff boundary
  // (LOTTO_CONSTANTS.CUTOFF_SECONDS, the same instant the backend stops
  // accepting tickets and pre-computes the result). Uses the existing source of
  // truth only (roundTimer.remainingSeconds) — no new interval/timer.
  useEffect(() => {
    if (buyCardOpen && Number(roundTimer?.remainingSeconds) <= LOTTO_CONSTANTS.CUTOFF_SECONDS) {
      setSelected([]);
      setSelectionError(null);
      setBuySelection(null);
      setBuyCardOpen(false);
    }
  }, [buyCardOpen, roundTimer?.remainingSeconds]);

  const handleBuyCardConfirm = async (buy) => {
    // Confirm = single existing placeBet call (unchanged API contract):
    // placeBet(roundId, selectedNumbers, total) where
    // total = amount x quantity x multiplier.
    const numbers = buySelection?.kind === 'color'
      ? (Array.isArray(selected) && selected.length > 0 ? selected : [])
      : buySelection?.value ? [buySelection.value] : selected;
    if (!activeRound || numbers.length === 0) return;
    const result = await placeBet(activeRound.id, numbers, buy.total);
    if (result?.success) {
      setSelected([]);
      setSelectionError(null);
      setBuySelection(null);
      setBuyCardOpen(false);
    }
  };

  // My History follows the selected timer category — refetch page 1 when category changes
  const prevHistoryCategoryRef = useRef(category);
  useEffect(() => {
    if (prevHistoryCategoryRef.current !== category) {
      prevHistoryCategoryRef.current = category;
      getHistory({ category, limit: 5, offset: 0, append: false });
    }
  }, [category, getHistory]);

  // Numeric pagination — jump to a specific page of My History (5 per page)
  const handleGoToHistoryPage = useCallback(
    (page) => {
      const limit = historyMeta?.limit || 5;
      const nextOffset = Math.max(0, (page - 1) * limit);
      getHistory({ category, limit, offset: nextOffset, append: false });
    },
    [category, getHistory, historyMeta?.limit],
  );

  // Numeric pagination — jump to a specific page of Game History (5 per page)
  const handleGoToResultsPage = useCallback(
    (page) => {
      const limit = resultsMeta?.limit || 5;
      const nextOffset = Math.max(0, (page - 1) * limit);
      getLastResult({ limit, offset: nextOffset, append: false });
    },
    [getLastResult, resultsMeta?.limit],
  );

  // Game History tab refresh — refetches recent draws from the backend
  // (existing hook function; sets recentResults + lastResult).
  const handleRefreshGame = useCallback(() => {
    getLastResult({ limit: 5, offset: 0, append: false });
  }, [getLastResult]);

  return (
    <div className="lotto-premium relative min-h-screen overflow-hidden p-3 sm:p-5">
      <div className="lotto-glow-total" aria-hidden>
        <div
          className="lotto-glow-orb"
          style={{ top: '-10%', left: '-18%', width: 340, height: 340, background: 'rgba(99,102,241,0.35)' }}
        />
        <div
          className="lotto-glow-orb"
          style={{ top: '36%', right: '-22%', width: 380, height: 380, background: 'rgba(249,115,22,0.12)' }}
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-4">
        <LottoHeader
          onBack={onBack}
          resultMode={controls?.resultMode}
          balance={balance}
          loading={loading}
        />

        <LottoPeriodTimer
          activeRound={activeRound}
          category={category}
          onCategoryChange={selectCategory}
          remainingSeconds={roundTimer.remainingSeconds}
          recentResults={recentResults}
          revealedResult={revealedResult}
          phase={roundTimer.phase}
          isExpiring={roundTimer.isExpiring}
          muted={muted}
          onToggleMute={toggleMute}
        />

        <div className="relative">
          <LottoNumberGrid
            selectedNumbers={selected}
            onToggleNumber={handleToggleNumber}
            onToggleGroup={handleToggleGroup}
            disabled={isLocked}
            maxSelections={LOTTO_CONSTANTS.MAX_SELECTIONS}
            forbiddenGroup={null}
            selectionError={selectionError}
          />

          {/* Countdown — runs INSIDE the ball card only (never over the rest
              of the screen). Same final-seconds window as before. */}
          <CountdownOverlay
            open={roundTimer.isExpiring || roundTimer.phase === TIMER_PHASE.DRAWING}
            remainingSeconds={roundTimer.remainingSeconds}
            selectedNumbers={selected}
            phase={roundTimer.phase}
            embedded
          />

          {/* Win/Loss settlement popup — constrained INSIDE the Pick Number area
              (not full screen). Rendered after result.mp3 fully finishes. */}
          <WinLossPopup
            value={settlementDisplay}
            onClose={handleCloseSettlement}
            embedded
          />
        </div>

                {/* Ticket Summary card removed (TPPlay direct flow:
            tap ANY number/color -> shared bottom LottoBuyCard opens). */}
        <LottoHistoryTabs
          recentResults={recentResults}
          gameLoading={resultsLoading}
          onRefreshGame={handleRefreshGame}
          category={category}
          resultsMeta={resultsMeta}
          onGoToResultsPage={handleGoToResultsPage}
          history={history}
          historyLoading={historyLoading}
          historyMeta={historyMeta}
          onGoToHistoryPage={handleGoToHistoryPage}
        />
      </div>

      {/* TPPlay-style Buy Card confirmation layer (overlay + bottom sheet).
          Single shared <LottoBuyCard selection=...> — every number, color
          group and quick selector routes through handleBetSelection. */}
      <LottoBuyCard
        open={buyCardOpen}
        onClose={handleCloseBuyCard}
        onConfirm={handleBuyCardConfirm}
        gameTitle={buyCardGameTitle}
        selectionLabel={buyCardSelectionLabel}
        balance={balance}
        submitting={placingBet}
        disabled={isLocked}
        isAuthenticated={isAuthenticated}
      />
    </div>
  );
}