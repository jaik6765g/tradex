// src/marketplace/games/lotto/components/LottoPeriodTimer.jsx
// Live period + countdown strip. The countdown is server-authoritative:
// `remainingSeconds` is derived from the active round's backend `drawAt`
// by the canonical useLottoRoundTimer hook (never a local countdown).

import React from 'react';

import { Clock, Trophy } from 'lucide-react';

import { formatRemainingSeconds } from '../utils/lottoPresentation';
import { isRoundOpenForPurchase } from '../utils/lottoState';
import { TIMER_PHASE } from '../utils/lottoTimer';

const DURATION_TABS = [
  { category: 'THIRTY_SEC', label: '30 Sec' },
  { category: 'ONE_MIN', label: '1 Min' },
  { category: 'THREE_MIN', label: '3 Min' },
  { category: 'FIVE_MIN', label: '5 Min' },
];

const PHASE_LABELS = {
  [TIMER_PHASE.DRAWING]: 'Drawing result…',
  [TIMER_PHASE.AWAITING_NEXT]: 'Loading next round…',
};

const LottoPeriodTimer = ({
  activeRound,
  category,
  onCategoryChange,
  remainingSeconds,
  phase = TIMER_PHASE.IDLE,
  isExpiring = false,
}) => {
  const hasActiveRound = Boolean(activeRound);
  const safeRemaining = Number.isFinite(remainingSeconds)
    ? Math.max(0, remainingSeconds)
    : 0;
  const isOpen = isRoundOpenForPurchase({
    hasActiveRound,
    status: activeRound?.status,
    timerDuration: safeRemaining,
  });
  const isTransition = phase === TIMER_PHASE.DRAWING
    || phase === TIMER_PHASE.AWAITING_NEXT;
  const isUrgent = isExpiring || (safeRemaining > 0 && safeRemaining <= 10);

  return (
    <section className="rounded-[16px] bg-white border border-[#E5E7EB] shadow-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Live Period — backend round number (period) */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FBBF24] to-[#F59E0B] shadow-md">
            <Trophy size={18} className="text-white" strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A2B3]">
              Current Period
            </p>
            <p className="truncate text-lg font-black tabular-nums leading-tight text-[#111827]">
              {hasActiveRound
                ? `#${activeRound.roundNumber}`
                : 'Waiting for next round…'}
            </p>
            {hasActiveRound && (
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A2B3]">
                {String(activeRound.category || '').replace(/_/g, ' ')}
              </p>
            )}
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] border border-[#E2E8F0] px-2.5 py-0.5 text-[10px] font-bold text-[#475467] uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-[#94A3B8]" />
            {activeRound?.status || 'WAITING'}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
              isTransition
                ? 'bg-[#FFF7ED] border-[#FED7AA] text-[#C2410C]'
                : isOpen
                ? 'bg-[#ECFDF3] border-[#A7F3D0] text-[#047857]'
                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B42318]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isTransition
                  ? 'bg-[#FB923C]'
                  : isOpen
                  ? 'bg-[#34D399]'
                  : 'bg-[#F87171]'
              }`}
            />
            {isTransition
              ? 'Draw In Progress'
              : hasActiveRound && isOpen
              ? 'Betting Open'
              : 'Betting Closed'}
          </span>
        </div>

        {/* Draw At + Countdown (server-authoritative MM:SS) */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A2B3]">
              Draw At
            </p>
            <p className="text-sm font-extrabold text-[#475467] tabular-nums">
              {activeRound?.drawAt
                ? new Date(activeRound.drawAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })
                : '—'}
            </p>
          </div>

          <div
            className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${
              isTransition
                ? 'border-[#C7D7FE] bg-[#EEF4FF]'
                : isUrgent
                ? 'border-[#FECACA] bg-[#FEF2F2]'
                : 'border-[#FDE68A] bg-[#FFFAEB]'
            }`}
            role="timer"
            aria-label={`${safeRemaining} seconds until draw`}
          >
            <Clock
              size={16}
              strokeWidth={2.6}
              className={isUrgent ? 'text-[#EF4444]' : 'text-[#B54708]'}
            />
            <span
              className={`text-lg font-black tabular-nums ${
                isTransition
                  ? 'text-[#3538CD]'
                  : isUrgent
                  ? 'text-[#EF4444]'
                  : 'text-[#111827]'
              }`}
            >
              {formatRemainingSeconds(safeRemaining)}
            </span>
          </div>
        </div>
      </div>

      {/* Transition note */}
      {isTransition && (
        <p className="mt-2 text-center text-[10px] font-bold text-[#3B82F6]">
          {PHASE_LABELS[phase] || 'Please wait…'}
        </p>
      )}

      {/* Duration Pills */}
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A2B3]">
          Game Duration
        </p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {DURATION_TABS.map((tab) => {
            const isActive = tab.category === category;
            return (
              <button
                key={tab.category}
                type="button"
                onClick={() => onCategoryChange(tab.category)}
                className={`h-10 rounded-xl text-xs font-black transition border-2 ${
                  isActive
                    ? 'border-[#F5B800] bg-[#FFFAEB] text-[#B54708] shadow-sm'
                    : 'border-[#E5E7EB] bg-white text-[#475467] hover:border-[#D0D5DD]'
                }`}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default LottoPeriodTimer;