// src/marketplace/games/lotto/LottoGame.jsx
// Premium Lotto experience. Composition layer only — all game state lives
// in useLottoGame (polling, idempotency, wallet refresh) and all timer
// state lives in useLottoRoundTimer (server-authoritative countdown from
// the active round's backend drawAt, with a guarded completion flow).

import React, { useCallback, useEffect, useRef, useState } from 'react';

import LottoHeader from './components/LottoHeader';
import LottoPeriodTimer from './components/LottoPeriodTimer';
import LottoNumberGrid from './components/LottoNumberGrid';
import LottoBuyTicket from './components/LottoBuyTicket';
import LottoHistoryTabs from './components/LottoHistoryTabs';

import WinLossPopup from '../../../shared/components/WinLossPopup';

import { useLottoGame } from './hooks/useLottoGame';
import { useLottoRoundTimer } from './hooks/useLottoRoundTimer';
import { LOTTO_CONSTANTS, CATEGORY_DURATION_SECONDS } from './utils/constants';
import {
  isGroupToggleForbidden,
  isRoundOpenForPurchase,
} from './utils/lottoState';
import { TIMER_PHASE, isNewRound } from './utils/lottoTimer';

import './LottoPremium.css';

export default function LottoGame({ onBack } = {}) {
  const [selected, setSelected] = useState([]);
  const [bet, setBet] = useState(LOTTO_CONSTANTS.MIN_BET);
  const [forbiddenGroup, setForbiddenGroup] = useState(null);
  const [selectionError, setSelectionError] = useState(null);

  const {
    loading,
    placingBet,
    balance,
    activeRound,
    category,
    recentResults,
    resultsLoading,
    resultsMeta,
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
  } = useLottoGame();

  // ------------------------------------------------------------------
  // Round completion flow. The canonical timer hook guarantees this runs
  // at most once concurrently and once per round id; here we simply refresh
  // the backend state (active round + results + tickets + balance).
  // ------------------------------------------------------------------
  const handleRoundExpire = useCallback(async () => {
    await refreshLottoState();
  }, [refreshLottoState]);

  const roundTimer = useLottoRoundTimer({
    round: activeRound,
    onComplete: handleRoundExpire,
  });

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

  const isPaused = controls?.paused || false;
  const isRoundOpen = isRoundOpenForPurchase({
    hasActiveRound: Boolean(activeRound),
    status: activeRound?.status,
    timerDuration: roundTimer.remainingSeconds,
  });
  const isLocked =
    loading ||
    placingBet ||
    isPaused ||
    !isAuthenticated ||
    !isRoundOpen ||
    roundTimer.phase !== TIMER_PHASE.COUNTDOWN;

  const handleToggleNumber = (value) => {
    if (isLocked) return;
    setSelectionError(null);
    setForbiddenGroup(null);
    setSelected((prev) => {
      if (prev.includes(value)) {
        return prev.filter((v) => v !== value);
      }
      if (prev.length >= LOTTO_CONSTANTS.MAX_SELECTIONS) {
        setSelectionError(`Maximum ${LOTTO_CONSTANTS.MAX_SELECTIONS} numbers allowed.`);
        return prev;
      }
      return [...prev, value];
    });
  };

  const handleToggleGroup = (groupKey, numbers) => {
    if (isLocked) return;
    setSelectionError(null);

    if (isGroupToggleForbidden(groupKey, selected)) {
      setForbiddenGroup(groupKey);
      setSelectionError(
        'This group cannot be combined with your current selection (would cover all 16 outcomes).',
      );
      return;
    }

    setForbiddenGroup(null);
    setSelected((prev) => {
      const allSelected = numbers.every((n) => prev.includes(n));
      if (allSelected) {
        return prev.filter((v) => !numbers.includes(v));
      }
      const merged = Array.from(new Set([...prev, ...numbers]));
      if (merged.length > LOTTO_CONSTANTS.MAX_SELECTIONS) {
        setSelectionError(`Maximum ${LOTTO_CONSTANTS.MAX_SELECTIONS} numbers allowed.`);
        return prev;
      }
      return merged;
    });
  };

  const handlePlaceTicket = async () => {
    if (!activeRound || selected.length === 0) return;
    const result = await placeBet(activeRound.id, selected, bet);
    if (result?.success) {
      setSelected([]);
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
          style={{ top: '36%', right: '-22%', width: 380, height: 380, background: 'rgba(245,184,0,0.12)' }}
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
          phase={roundTimer.phase}
          isExpiring={roundTimer.isExpiring}
        />

        <LottoNumberGrid
          selectedNumbers={selected}
          onToggleNumber={handleToggleNumber}
          onToggleGroup={handleToggleGroup}
          onClearSelection={() => setSelected([])}
          disabled={isLocked}
          maxSelections={LOTTO_CONSTANTS.MAX_SELECTIONS}
          forbiddenGroup={forbiddenGroup}
        />

        <LottoBuyTicket
          activeRound={activeRound}
          selectedNumbers={selected}
          betAmount={bet}
          setBetAmount={setBet}
          balance={balance}
          disabled={isLocked}
          submitting={placingBet}
          isAuthenticated={isAuthenticated}
          error={error}
          selectionError={selectionError}
          latestTicket={latestTicket}
          onPlaceTicket={handlePlaceTicket}
          remainingSeconds={roundTimer.remainingSeconds}
          timerPhase={roundTimer.phase}
        />

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

      {/* Win/Loss settlement popup */}
      <WinLossPopup
        value={settlementPopup}
        onClose={dismissSettlementPopup}
      />
    </div>
  );
}