// src/marketplace/games/lotto/components/LottoResultPopup.jsx
// ============================================================
// Screenshot-style settlement card — used ONLY by the Lotto game
// (Pulse Trade keeps the shared WinLossPopup untouched). Renders
// the popup.png card frame asset:
//   - LOSS → blue/silver frame as-is ("Sorry" card)
//   - WIN  → the same frame hue-rotated to orange
//            ("Congratulations" card) + falling confetti
// Auto-dismisses after 3 seconds ("3 seconds auto close"), or on
// the round X button. The popup is only shown after result.mp3 has
// fully finished (LottoGame settlement reveal pipeline).
// ============================================================

import React, { useEffect, useRef } from 'react';

import { Check, X } from 'lucide-react';

import popupFrameUrl from '../../../../assets/popup.png';
import { CATEGORY_DURATION_SECONDS } from '../utils/constants';
import { getNumberGroups, GROUP_TONE } from '../utils/lottoUi';

/** Auto-close delay — matches the card's "3 seconds auto close" footer. */
export const LOTTO_RESULT_POPUP_AUTO_CLOSE_MS = 3000;

const RESULT_SYMBOL_PATTERN = /^[0-9A-F]$/i;

/**
 * Builds the "Lottery results" chips for the card:
 * [Color] [Drawn number] [Big|Small] — all tinted with the result's
 * primary group tone (GREEN 0-7 / RED 8-F). Returns null when the
 * drawn symbol is unknown so the row is hidden cleanly.
 */
const buildResultChips = (symbol) => {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!RESULT_SYMBOL_PATTERN.test(normalized)) {
    return null;
  }

  const groups = getNumberGroups(normalized);
  const tone = groups ? GROUP_TONE[groups.primary] : GROUP_TONE.GREEN;
  const colorLabel = groups
    ? `${groups.primary.charAt(0)}${groups.primary.slice(1).toLowerCase()}`
    : '';

  const hexValue = parseInt(normalized, 16);
  const parityLabel = Number.isFinite(hexValue) && hexValue % 2 === 0 ? 'Even' : 'Odd';

  return [
    { key: 'color', label: colorLabel, tone },
    { key: 'number', label: normalized, tone },
    { key: 'size', label: parityLabel, tone },
  ];
};

/** "Lotto 30sec" style label from the settled ticket's backend category. */
const buildPeriodLabel = (category) => {
  const seconds = CATEGORY_DURATION_SECONDS[category];
  return Number.isFinite(seconds) ? `Lotto ${seconds}sec` : 'Lotto';
};

/** Confetti pieces (win card only) — light pieces falling over the medal. */
const CONFETTI_PIECES = [
  { left: '4%', delay: '0s', drift: '-18px', color: '#FFD34D', size: 9, round: false },
  { left: '12%', delay: '0.35s', drift: '10px', color: '#FF6B5E', size: 7, round: true },
  { left: '20%', delay: '0.12s', drift: '-8px', color: '#FFFFFF', size: 8, round: false },
  { left: '28%', delay: '0.5s', drift: '16px', color: '#22C55E', size: 6, round: true },
  { left: '36%', delay: '0.05s', drift: '-12px', color: '#FFD34D', size: 8, round: false },
  { left: '45%', delay: '0.42s', drift: '8px', color: '#FFFFFF', size: 6, round: true },
  { left: '55%', delay: '0.2s', drift: '-10px', color: '#FF9F43', size: 8, round: false },
  { left: '64%', delay: '0.55s', drift: '12px', color: '#FF6B5E', size: 7, round: false },
  { left: '72%', delay: '0.08s', drift: '-16px', color: '#22C55E', size: 7, round: true },
  { left: '80%', delay: '0.3s', drift: '10px', color: '#FFD34D', size: 8, round: false },
  { left: '88%', delay: '0.48s', drift: '-8px', color: '#FFFFFF', size: 6, round: true },
  { left: '95%', delay: '0.15s', drift: '14px', color: '#FF9F43', size: 7, round: false },
];

// ============================================================
// COMPONENT
// ============================================================

export default function LottoResultPopup({
  value,
  onClose,
  /**
   * Kept for parity with the shared WinLossPopup: when true the overlay is
   * `absolute` (confined to the nearest positioned parent), default is the
   * full-viewport `fixed` card shown in the reference design.
   */
  embedded = false,
}) {
  // Keep the latest onClose in a ref so the auto-close timer is armed ONCE
  // per settlement id — parent re-renders (5s polling) must never reset it,
  // otherwise the 3s auto-close would never fire.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!value) {
      return undefined;
    }

    const timer = window.setTimeout(
      () => onCloseRef.current?.(),
      LOTTO_RESULT_POPUP_AUTO_CLOSE_MS,
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [value?.id]);

  if (!value) {
    return null;
  }

  const isWin = value.outcome === 'win';
  const chips = buildResultChips(value.resultSymbol);
  const periodLabel = value.periodLabel ?? buildPeriodLabel(value.category);
  const period = value.period ?? null;

  return (
    <div
      className={`
        ${embedded ? 'absolute' : 'fixed'}
        inset-0
        z-[95]
        flex
        items-center
        justify-center
        bg-black/60
        animate-[lottoResultFadeIn_0.2s_ease-out]
      `}
      role="dialog"
      aria-modal="true"
      aria-label={isWin ? 'Congratulations' : 'Sorry'}
    >
      <style>{`
        @keyframes lottoResultFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lottoResultPopIn {
          from { transform: scale(0.9); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes lottoResultConfettiFall {
          0%   { transform: translate3d(0, -24px, 0) rotate(0deg); opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translate3d(var(--drift, 0px), 300px, 0) rotate(460deg); opacity: 0; }
        }
        /* Orange variant of the popup.png frame for WIN outcomes:
           the art is light blue (~hue 215°) — +165° lands on orange. */
        .lotto-result-frame--win {
          filter: hue-rotate(165deg) saturate(1.55) brightness(1.02);
        }
        .lotto-result-confetti {
          position: absolute;
          top: 0;
          width: var(--size, 8px);
          height: var(--size, 8px);
          background: var(--color, #FFD34D);
          border-radius: var(--radius, 2px);
          opacity: 0;
          animation: lottoResultConfettiFall 2.6s linear infinite;
        }
      `}</style>

      <div
        className="relative flex flex-col items-center animate-[lottoResultPopIn_0.25s_ease-out]"
      >
        {/* Win-only confetti layer (above the frame art, below the text) */}
        {isWin && (
          <div
            className="
              pointer-events-none
              absolute
              left-1/2
              top-[-6%]
              z-10
              h-[52%]
              w-[120%]
              -translate-x-1/2
            "
            aria-hidden
          >
            {CONFETTI_PIECES.map((piece, index) => (
              <span
                key={`${piece.left}-${index}`}
                className="lotto-result-confetti"
                style={{
                  left: piece.left,
                  animationDelay: piece.delay,
                  '--drift': piece.drift,
                  '--size': `${piece.size}px`,
                  '--color': piece.color,
                  '--radius': piece.round ? '50%' : '2px',
                }}
              />
            ))}
          </div>
        )}

        {/* Card frame (popup.png) with content positioned over the art.
            Width = min(78vw, 320px, 46vh) so the portrait card + close
            button always fit small phone viewports. */}
        <div
          className="relative drop-shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
          style={{ width: 'min(78vw, 320px, 46vh)' }}
        >
          <img
            src={popupFrameUrl}
            alt=""
            draggable={false}
            className={`block w-full select-none ${isWin ? 'lotto-result-frame--win' : ''}`}
          />

          <div className="absolute inset-0 z-20">
            {/* Title — right under the ribbon fold of the frame art */}
            <p
              className={`
                absolute
                left-0
                right-0
                -translate-y-1/2
                text-center
                text-[19px]
                font-bold
                ${isWin ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]' : 'text-[#4F6FA8]'}
              `}
              style={{ top: '33.5%' }}
            >
              {isWin ? 'Congratulations' : 'Sorry'}
            </p>

            {/* Lottery results chips — color / drawn number / Big-Small */}
            {chips && (
              <div
                className="
                  absolute
                  left-0
                  right-0
                  flex
                  -translate-y-1/2
                  items-center
                  justify-center
                  gap-1.5
                "
                style={{ top: '40.5%' }}
              >
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: isWin ? 'rgba(255,255,255,0.92)' : '#7D93BC' }}
                >
                  Lottery results
                </span>
                {chips.map((chip) => (
                  <span
                    key={chip.key}
                    className="
                      flex
                      h-[22px]
                      min-w-[30px]
                      items-center
                      justify-center
                      rounded-full
                      px-2
                      text-[11px]
                      font-bold
                      text-white
                    "
                    style={{ backgroundColor: chip.tone }}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}

            {/* Receipt (white paper) content — win: Bonus + amount,
                loss: plain "Lose"; both with the period lines */}
            <div
              className="
                absolute
                left-[13%]
                right-[13%]
                flex
                flex-col
                items-center
                justify-center
                gap-[2px]
              "
              style={{ top: '57.5%', height: '21%' }}
            >
              {isWin ? (
                <>
                  <span className="text-[13px] font-bold text-[#E5484D]">Bonus</span>
                  <span className="text-[21px] font-extrabold leading-tight text-[#E5484D]">
                    {value.amount}
                  </span>
                </>
              ) : (
                <span className="text-[20px] font-bold text-[#9AA3B2]">Lose</span>
              )}
              <span className="text-[10.5px] font-medium text-[#A7AEBB]">
                Period: {periodLabel}
              </span>
              {period != null && (
                <span className="text-[10.5px] font-medium text-[#A7AEBB]">{period}</span>
              )}
            </div>

            {/* Footer — "3 seconds auto close" */}
            <div
              className="
                absolute
                left-0
                right-0
                flex
                -translate-y-1/2
                items-center
                justify-center
                gap-1.5
              "
              style={{ top: '88.5%' }}
            >
              <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white">
                <Check
                  size={11}
                  strokeWidth={3.2}
                  className={isWin ? 'text-[#22C55E]' : 'text-[#5B7BB4]'}
                />
              </span>
              <span className="text-[11.5px] font-semibold text-white/95">
                3 seconds auto close
              </span>
            </div>
          </div>
        </div>

        {/* Round X close button below the card */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="
            mt-4
            flex
            h-11
            w-11
            items-center
            justify-center
            rounded-full
            border
            border-white/25
            bg-black/50
            text-white
            transition
            hover:bg-black/70
          "
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

