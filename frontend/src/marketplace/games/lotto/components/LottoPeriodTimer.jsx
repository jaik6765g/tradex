// src/marketplace/games/lotto/components/LottoPeriodTimer.jsx
// TPPlay / WinGo-inspired round header: duration tabs + main round card.
// Brand label shown to users is "Lotto".
//
// DISPLAY ONLY. This component renders the EXISTING round state:
//   - remainingSeconds / phase / isExpiring come from useLottoRoundTimer
//     (server-authoritative, derived from the active round's backend drawAt)
//   - the current period is activeRound.roundNumber (the real backend round)
//   - recent result balls come from the existing recentResults state
// It creates no timer, no interval, no period and no round of its own.

import React, { useState } from 'react';

import { Clock, ScrollText, Volume2, VolumeX, X } from 'lucide-react';

import { isRoundOpenForPurchase } from '../utils/lottoState';
import { TIMER_PHASE } from '../utils/lottoTimer';
import { COLOR_GROUPS, LOTTO_CONSTANTS, MULTIPLIERS } from '../utils/constants';
import { symbolToneName } from '../utils/lottoUi';
import { getBallImage } from '../utils/ballAssets';
import { mergeRevealedResult } from '../utils/lottoReveal';

// Existing categories only — 10 Min tab removed from the UI (display only;
// the backend TEN_MIN enum stays valid in the API layer).
const GAME_TABS = [
  { category: 'THIRTY_SEC', line1: 'Lotto', line2: '30sec' },
  { category: 'ONE_MIN', line1: 'Lotto 1', line2: 'Min' },
  { category: 'THREE_MIN', line1: 'Lotto 3', line2: 'Min' },
  { category: 'FIVE_MIN', line1: 'Lotto 5', line2: 'Min' },
];

const GAME_TITLES = {
  THIRTY_SEC: 'Lotto 30sec',
  ONE_MIN: 'Lotto 1 Min',
  THREE_MIN: 'Lotto 3 Min',
  FIVE_MIN: 'Lotto 5 Min',
};

const PHASE_LABELS = {
  [TIMER_PHASE.DRAWING]: 'Drawing result…',
  [TIMER_PHASE.AWAITING_NEXT]: 'Loading next round…',
};

const MAX_BALLS = 5;

// ---------------------------------------------------------------------------
// Recent-result balls — VISUAL ONLY. Real ball artwork (the same
// assets/lotto/*.webp used by the Pick Numbers grid) is preferred; the
// tone-based CSS ball below stays as a fallback for unsupported symbols so
// the tone still comes from the existing symbolToneName mapping (no game
// rule changes here).
//
// Sizes stay deliberately SMALL and the row below reserves a FIXED height per
// container breakpoint, so adding/removing balls can never change the round
// card's size.
// ---------------------------------------------------------------------------
const BALL_FACE_STYLES = {
  green: {
    background: 'radial-gradient(circle at 32% 26%, #DCFFE8 0%, #7BE8A4 45%, #2FBF68 100%)',
    border: '#2FA363',
  },
  red: {
    background: 'radial-gradient(circle at 32% 26%, #FFE4E4 0%, #FF969B 45%, #E8545B 100%)',
    border: '#C93B42',
  },
  yellow: {
    background: 'radial-gradient(circle at 32% 26%, #FFF4D8 0%, #FFD07E 45%, #F0A437 100%)',
    border: '#C9871F',
  },
  cyan: {
    background: 'radial-gradient(circle at 32% 26%, #E0FBFF 0%, #8FE7F5 45%, #3BB8CC 100%)',
    border: '#2A93A5',
  },
};

const ballFaceStyle = (symbol) => {
  const tone = symbolToneName(symbol);
  const face = BALL_FACE_STYLES[tone] || BALL_FACE_STYLES.cyan;
  return {
    background: face.background,
    border: `2px solid ${face.border}`,
    color: '#FFFFFF',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.28)',
    boxShadow:
      '0 3px 8px rgba(90, 60, 8, 0.35), inset 0 -4px 8px rgba(0, 0, 0, 0.14), inset 0 2px 5px rgba(255, 255, 255, 0.55)',
  };
};

// Compact recent-result ball. Real artwork (assets/lotto/*.webp) is clipped to
// a circle exactly like the Pick Numbers grid does — the artwork ships with an
// opaque background, so it is zoomed slightly (112%) and hidden by the round
// mask. `RESULT_BALL_SIZE` is shared by the ball AND by the row's reserved
// height, so the row height — and therefore the whole card — never changes.
const RESULT_BALL_SIZE =
  'h-[18px] w-[18px] @2xs:h-5 @2xs:w-5 @xs:h-[22px] @xs:w-[22px] @sm:h-6 @sm:w-6';

const ResultBall = ({ symbol }) => {
  const artwork = getBallImage(symbol);

  if (!artwork) {
    // Fallback only (0–9 / A–F always have artwork): keep the tone CSS ball.
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full text-[8px] font-black leading-none @2xs:text-[9px] @xs:text-[10px] @sm:text-[11px] ${RESULT_BALL_SIZE}`}
        style={ballFaceStyle(symbol)}
        title={`Result ${symbol}`}
      >
        {symbol}
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${RESULT_BALL_SIZE}`}
      title={`Result ${symbol}`}
    >
      <img
        src={artwork}
        alt={`Result ${symbol}`}
        draggable={false}
        className="pointer-events-none h-[112%] w-[112%] max-w-none select-none object-cover"
      />
    </span>
  );
};

// ---------------------------------------------------------------------------
// How to play — UI shell only. Every value is derived from the frozen
// LOTTO-01 constants, so there is no duplicated/hardcoded rule set.
// ---------------------------------------------------------------------------
const HowToPlaySheet = ({ open, onClose }) => {
  if (!open) return null;

  const baseMultiplier = MULTIPLIERS[1] || 16;
  const feePercent = Math.round((LOTTO_CONSTANTS.PLATFORM_FEE || 0) * 100);

  const rules = [
    {
      title: 'Pick your numbers',
      body: `Choose up to ${LOTTO_CONSTANTS.MAX_SELECTIONS} symbols from ${LOTTO_CONSTANTS.NUMBER_COUNT} (0–9, A–F). Only one outcome set per ticket is allowed.`,
    },
    {
      title: 'Colour groups',
      body: `GREEN ${COLOR_GROUPS.GREEN.join(' ')} · RED ${COLOR_GROUPS.RED.join(' ')} · YELLOW ${COLOR_GROUPS.YELLOW.join(' ')} · BLUE ${COLOR_GROUPS.BLUE.join(' ')}. Selecting opposite groups that cover all outcomes is not allowed.`,
    },
    {
      title: 'Payout',
      body: `Payout multiplier is ${baseMultiplier} ÷ number of selections, less a ${feePercent}% platform fee. Fewer selections means a higher multiplier.`,
    },
    {
      title: 'Cutoff',
      body: `Betting closes ${LOTTO_CONSTANTS.CUTOFF_SECONDS} seconds before the draw. The draw reveals one symbol and your ticket is settled automatically.`,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <button
        type="button"
        aria-label="Close how to play"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
      />
      <div className="relative w-full overflow-hidden rounded-t-3xl border border-[#26262E] bg-[#101014] shadow-[0_-18px_60px_rgba(0,0,0,0.65)] sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] px-4 py-3">
          <p className="text-[13px] font-black text-white">How to play</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/30"
          >
            <X size={15} strokeWidth={2.6} />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3.5">
          {rules.map((rule) => (
            <div key={rule.title} className="rounded-xl border border-[#26262E] bg-[#16161C] px-3 py-2.5">
              <p className="text-[11px] font-black text-[#F5F5F7]">{rule.title}</p>
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-[#9A9BA8]">{rule.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
// ---------------------------------------------------------------------------
// Main round header — tabs + round card. Pure presentation of existing state.
// ---------------------------------------------------------------------------
const LottoPeriodTimer = ({
  activeRound,
  category,
  onCategoryChange,
  remainingSeconds,
  recentResults,
  revealedResult,
  phase = TIMER_PHASE.IDLE,
  isExpiring = false,
  muted = false,
  onToggleMute,
}) => {
  const [howToOpen, setHowToOpen] = useState(false);

  const hasActiveRound = Boolean(activeRound);
  const safeRemaining = Number.isFinite(Number(remainingSeconds))
    ? Math.max(0, Number(remainingSeconds))
    : 0;

  // Existing betting gate — same helper the game already uses. No new cutoff.
  const isOpen = isRoundOpenForPurchase({
    hasActiveRound,
    status: activeRound?.status,
    timerDuration: safeRemaining,
  });

  const isTransition =
    phase === TIMER_PHASE.DRAWING || phase === TIMER_PHASE.AWAITING_NEXT;
  const isUrgent = isExpiring || (safeRemaining > 0 && safeRemaining <= 10);

  const gameTitle = GAME_TITLES[category] || 'Lotto 30sec';

  // Segmented countdown — derived from the SAME remainingSeconds value.
  const totalSeconds = Math.max(0, Math.floor(safeRemaining));
  const minutesText = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const secondsText = String(totalSeconds % 60).padStart(2, '0');

  const periodLabel = hasActiveRound ? activeRound?.roundNumber || '——' : '——';

  // Real recent results only (never hardcoded). Prefer the active category,
  // fall back to whatever the existing state provides.
  const allResults = Array.isArray(recentResults) ? recentResults : [];
  const categoryResults = category
    ? allResults.filter((item) => item?.category === category)
    : allResults;

  // The value revealed at 00:00 is PINNED as the newest ball (shared pure
  // helper): it comes from the pre-reveal cache, so it is on screen the instant
  // the countdown ends even though the backend list may still be a moment
  // behind — and that older list can never push it out or replace it.
  const mergedResults = mergeRevealedResult(
    categoryResults.length > 0 ? categoryResults : allResults,
    revealedResult,
    category,
  );

  const balls = mergedResults
    .map((item) => String(item?.result ?? '').trim().toUpperCase())
    .filter((symbol) => /^[0-9A-F]$/.test(symbol))
    .slice(0, MAX_BALLS);

  return (
    <div className="flex flex-col gap-3">
      {/* ── TOP GAME TABS ─────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible">
        {GAME_TABS.map((tab) => {
          const isActive = tab.category === category;
          return (
            <button
              key={tab.category}
              type="button"
              onClick={() => onCategoryChange?.(tab.category)}
              aria-pressed={isActive}
              className={`flex min-w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border px-3 py-2.5 transition-all active:scale-[0.97] ${
                isActive
                  ? 'border-[#FBBF24] bg-gradient-to-b from-[#FBBF24] to-[#F59E0B] shadow-[0_8px_20px_-8px_rgba(251,191,36,0.7)]'
                  : 'border-[#26262E] bg-[#16161C] hover:border-[#34343E]'
              }`}
            >
              <Clock
                size={15}
                strokeWidth={2.6}
                className={isActive ? 'text-[#3A2A05]' : 'text-[#7C7D8A]'}
              />
              <span className="text-center leading-tight">
                <span
                  className={`block text-[11px] font-black ${
                    isActive ? 'text-[#3A2A05]' : 'text-[#B9BAC6]'
                  }`}
                >
                  {tab.line1}
                </span>
                <span
                  className={`block text-[10px] font-bold ${
                    isActive ? 'text-[#4A3608]' : 'text-[#7C7D8A]'
                  }`}
                >
                  {tab.line2}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {/* ── MAIN ROUND CARD — WinGo golden-ticket style ──
             Sizes are driven by @container (the CARD's own width), not the
             viewport, because the app shell is a fixed 460px column on
             desktop — viewport `sm:` variants would overflow it. The layout
             is ALWAYS the reference's single row: left = pill + title +
             balls, right = time remaining + flip clock + period. */}
      <div
        className={`@container relative overflow-hidden rounded-2xl border shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] sm:rounded-[22px] ${
          isUrgent
            ? 'border-[#8A5A10] bg-gradient-to-br from-[#E4B447] via-[#D2A02F] to-[#BC8A1F]'
            : 'border-[#B08424] bg-gradient-to-br from-[#F2D37E] via-[#E9C15C] to-[#DEB04A]'
        }`}
      >
        <div className="relative flex flex-row items-stretch px-2.5 py-2.5 @2xs:px-3 @2xs:py-3 @xs:px-3 @xs:py-3 @sm:px-4 @sm:py-4">
          {/* LEFT: How to play + game title + recent results */}
          <div className="flex min-w-0 flex-1 flex-col items-start justify-center pr-2.5 @xs:pr-3 @sm:pr-3.5">
            <button
              type="button"
              onClick={() => setHowToOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#7A5A12] px-2 py-[3px] text-[10px] font-bold text-[#5A3E08] transition-colors hover:bg-[#00000010] @xs:gap-2 @xs:px-2.5 @xs:py-1 @xs:text-[11px] @sm:px-3.5 @sm:text-[12px]"
            >
              <ScrollText className="h-3 w-3 @xs:h-3.5 @xs:w-3.5 @sm:h-4 @sm:w-4" strokeWidth={2.4} />
              How to play
            </button>

            <p className="mt-1.5 whitespace-nowrap text-[11px] font-bold text-[#5A3E08] @xs:mt-2 @xs:text-[12px] @sm:mt-2.5 @sm:text-[13px]">
              {gameTitle}
            </p>

            {/* Recent results — fixed-height row (RESULT_BALL_SIZE per
                breakpoint) so balls can be added/removed without ever
                changing the card's size. */}
            <div className="mt-1.5 flex h-[18px] flex-nowrap items-center gap-1 @2xs:h-5 @xs:mt-2 @xs:h-[22px] @xs:gap-1.5 @sm:mt-2.5 @sm:h-6 @sm:gap-1.5">
              {balls.length > 0 ? (
                balls.map((symbol, index) => (
                  <ResultBall key={`${symbol}-${index}`} symbol={symbol} />
                ))
              ) : (
                <span className="text-[10px] font-semibold text-[#6A4E10] @xs:text-[11px]">
                  No results yet
                </span>
              )}
            </div>
          </div>

          {/* Dashed perforation divider with ticket notches */}
          <div className="pointer-events-none relative w-0" aria-hidden>
            <div className="absolute inset-y-2 left-0 border-l-2 border-dashed border-[#B98A1C]/70 @sm:inset-y-3" />
            <div className="absolute -left-px top-[-16px] h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#0B0B10] @sm:top-[-20px]" />
            <div className="absolute -left-px bottom-[-16px] h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#0B0B10] @sm:bottom-[-20px]" />
          </div>

          {/* RIGHT: time remaining + segmented timer + period */}
          <div className="flex shrink-0 flex-col items-end justify-center gap-1 pl-2.5 @xs:pl-3 @sm:pl-3.5">
            <p className="whitespace-nowrap text-[10px] font-black text-[#5A3E08] @2xs:text-[11px] @xs:text-[12px] @sm:text-[13px]">
              Time remaining
            </p>

            <div className="flex items-center gap-0.5 @xs:gap-1">
              <DigitCell value={minutesText[0]} />
              <DigitCell value={minutesText[1]} />
              <ColonCell />
              <DigitCell value={secondsText[0]} />
              <DigitCell value={secondsText[1]} />
            </div>

            <p className="mt-0.5 whitespace-nowrap text-[10px] font-black tabular-nums text-[#5A3E08] @2xs:text-[11px] @xs:text-[12px] @sm:text-[13px]">
              {periodLabel}
            </p>

            {typeof onToggleMute === 'function' && (
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
                aria-pressed={muted}
                className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#7A5A12]/60 text-[#5A3E08] transition-colors hover:bg-[#00000010] @sm:h-6 @sm:w-6"
              >
                {muted ? (
                  <VolumeX className="h-2.5 w-2.5 @sm:h-3 @sm:w-3" strokeWidth={2.6} />
                ) : (
                  <Volume2 className="h-2.5 w-2.5 @sm:h-3 @sm:w-3" strokeWidth={2.6} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <HowToPlaySheet open={howToOpen} onClose={() => setHowToOpen(false)} />
    </div>
  );
};

// Single segmented timer cell — black flip-clock block with a concave scoop
// cut at the top-left corner, matching the reference's flip-clock style.
// The mask is applied to the inner cell; drop-shadow sits on the wrapper so
// the shadow follows the scooped shape (filter runs after masking on parent).
const FLIP_NOTCH_MASK = 'radial-gradient(circle 5px at 0 0, transparent 5px, #000 5.5px)';

const DigitCell = ({ value }) => (
  <span className="inline-flex drop-shadow-[0_2px_5px_rgba(90,60,8,0.45)]">
    <span
      className="flex h-8 w-6 items-center justify-center rounded-md bg-[#1A1A1A] text-[13px] font-black leading-none tabular-nums text-white @2xs:h-9 @2xs:text-[14px] @xs:h-10 @xs:w-[26px] @xs:text-[15px] @sm:h-11 @sm:w-8 @sm:text-[18px]"
      style={{ WebkitMaskImage: FLIP_NOTCH_MASK, maskImage: FLIP_NOTCH_MASK }}
    >
      {value}
    </span>
  </span>
);

const ColonCell = () => (
  <span className="inline-flex drop-shadow-[0_2px_5px_rgba(90,60,8,0.45)]">
    <span
      className="flex h-8 w-2.5 items-center justify-center bg-[#1A1A1A] text-[11px] font-black leading-none text-white @2xs:h-9 @2xs:text-[12px] @xs:h-10 @xs:w-3 @xs:text-[13px] @sm:h-11 @sm:w-3 @sm:text-[15px]"
      style={{ WebkitMaskImage: FLIP_NOTCH_MASK, maskImage: FLIP_NOTCH_MASK }}
    >
      :
    </span>
  </span>
);

export default LottoPeriodTimer;

