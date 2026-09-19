// ============================================================
// frontend/src/shared/components/WinLossPopup.tsx
// ============================================================
// Shared settlement popup used by LOTTO and Pulse Trade.
// Renders a centered modal whenever a bet/trade settles with a
// WIN / LOSS / DRAW outcome. Auto-dismisses after AUTO_CLOSE_MS.
//
// Two layouts, chosen by the caller's data (no new popup system):
//   - Pulse Trade WIN/LOSS (resolver mapped a movement card):
//     the Lotto-style frame card — up.png / down.webp IS the card,
//     tinted GREEN (win) / RED (loss), text over the art.
//   - DRAW + every legacy caller: the original dark card with the
//     outcome icon (byte-for-byte unchanged).
// ============================================================

import React, { useEffect } from 'react';

import {
  Check,
  Minus,
  PartyPopper,
  TrendingDown,
  Trophy,
  X,
} from 'lucide-react';

import downArtworkUrl from '../../assets/down.webp';
import upArtworkUrl from '../../assets/up.png';
// Pulse Trade only: pure GREEN/RED card-colour map for the movement
// frame card (same hue-rotate trick the Lotto result card uses).
// Nothing else in this shared popup depends on it.
import { resolvePulseResultToneStyle } from '../../trade/pulse/utils/pulseResultCard';

export const WIN_LOSS_POPUP_AUTO_CLOSE_MS = 6000;

// Warm BOTH frame assets once (browser only) so the very first Pulse
// movement card can never flash while the artwork is fetched — each
// card mounts both frames and only toggles opacity.
if (typeof window !== 'undefined') {
  [upArtworkUrl, downArtworkUrl].forEach((url) => {
    const image = new window.Image();
    image.decoding = 'async';
    image.src = url;
  });
}

export interface WinLossPopupData {
  /** Unique id — used to (re)arm the auto-close timer. */
  id: string;
  outcome: 'win' | 'loss' | 'draw';
  title: string;
  /** Secondary line, e.g. "Round 000012 • 4 numbers". */
  detail: string;
  /** Main amount line, e.g. "+250.00 TDX". */
  amount: string;
  /** Optional helper line, e.g. "Winnings added to your wallet". */
  meta?: string;
  /**
   * Pulse Trade only: price-movement card resolved from the FINALIZED
   * backend settlement (direction + result). UP renders up.png,
   * DOWN renders down.webp. Omitted for Lotto and DRAW.
   */
  movement?: 'UP' | 'DOWN';
  /**
   * Pulse Trade only: card colour state from the same resolver
   * (GREEN win / RED loss). Omitted for Lotto and DRAW.
   */
  tone?: 'GREEN' | 'RED' | 'NEUTRAL';
  /** Optional trade pair label for the artwork caption, e.g. "BTC/USDT". */
  pairLabel?: string;
}

const OUTCOME_STYLES: Record<
  WinLossPopupData['outcome'],
  {
    accent: string;
    border: string;
    iconBg: string;
    iconColor: string;
    amountColor: string;
    Icon: typeof Trophy;
  }
> = {
  win: {
    accent: 'bg-[#22C55E]',
    border: 'border-[#86EFAC]',
    iconBg: 'bg-[#10251A]',
    iconColor: 'text-[#4ADE80]',
    amountColor: 'text-[#4ADE80]',
    Icon: Trophy,
  },
  loss: {
    accent: 'bg-[#EF4444]',
    border: 'border-[#4A2323]',
    iconBg: 'bg-[#281313]',
    iconColor: 'text-[#DC2626]',
    amountColor: 'text-[#DC2626]',
    Icon: TrendingDown,
  },
  draw: {
    accent: 'bg-[#FF8F3D]',
    border: 'border-[#3A281C]',
    iconBg: 'bg-[#2A190D]',
    iconColor: 'text-[#FF7A18]',
    amountColor: 'text-[#FF7A18]',
    Icon: Minus,
  },
};

const OUTCOME_LABEL: Record<WinLossPopupData['outcome'], string> = {
  win: 'WIN',
  loss: 'LOSS',
  draw: 'DRAW',
};

// ============================================================
// SHARED KEYFRAMES (used by both popup layouts)
// ============================================================

const WINLOSS_KEYFRAMES = `
  @keyframes winlossFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes winlossPopIn {
    from { transform: scale(0.92); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }
`;

// ============================================================
// PULSE TRADE MOVEMENT FRAME CARD
// ============================================================
// Mirrors the Lotto settlement card (LottoResultPopup): the
// up.png / down.webp asset IS the card — no dark wrapper — and the
// text sits on the art:
//   ribbon band  -> result title
//   upper art    -> WIN/LOSS + pair chips
//   white paper  -> settlement amount + context (receipt)
//   lower art    -> auto-close footer
// The light-blue frame art is hue-rotated to GREEN (win) / RED
// (loss) exactly like the Lotto card.
//
// Both frames stay MOUNTED and only opacity toggles, so a new
// settlement can never flash a blank or the previous card.
// ============================================================

function PulseResultFrameCard({
  value,
  onClose,
}: {
  value: WinLossPopupData;
  onClose: () => void;
}) {
  const movement = value.movement === 'DOWN' ? 'DOWN' : 'UP';

  const tone = resolvePulseResultToneStyle(
    value.tone ?? (value.outcome === 'win' ? 'GREEN' : 'RED'),
  );

  const autoCloseSeconds = Math.round(WIN_LOSS_POPUP_AUTO_CLOSE_MS / 1000);

  const frameStyle = { filter: tone.frameFilter };

  const frameClass = 'block w-full select-none transition-opacity duration-200';

  return (
    <div className="relative flex flex-col items-center animate-[winlossPopIn_0.25s_ease-out]">
      <style>{WINLOSS_KEYFRAMES}</style>

      {/* Card frame (up.png / down.webp) with the content over the art.
          Width = min(78vw, 320px, 46vh) so the portrait card + close
          button always fit small phone viewports. */}
      <div
        className="relative drop-shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
        style={{ width: 'min(78vw, 320px, 46vh)' }}
      >
        <img
          src={upArtworkUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={`${frameClass} ${movement === 'UP' ? 'opacity-100' : 'opacity-0'}`}
          style={frameStyle}
        />
        <img
          src={downArtworkUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={`${frameClass} absolute inset-0 ${
            movement === 'DOWN' ? 'opacity-100' : 'opacity-0'
          }`}
          style={frameStyle}
        />

        <div className="absolute inset-0 z-20">
          {/* Result title — on the ribbon band under the badge */}
          <p
            className="
              absolute
              left-0
              right-0
              -translate-y-1/2
              px-6
              text-center
              text-[18px]
              font-bold
              text-white
              drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]
            "
            style={{ top: '25.5%' }}
          >
            {value.title}
          </p>

          {/* Outcome + pair chips — same chip row as the Lotto card */}
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
              px-3
            "
            style={{ top: '33%' }}
          >
            <span
              className="
                flex
                h-[22px]
                min-w-[42px]
                items-center
                justify-center
                rounded-full
                px-2
                text-[11px]
                font-bold
                uppercase
                text-white
              "
              style={{ backgroundColor: tone.chip }}
            >
              {OUTCOME_LABEL[value.outcome]}
            </span>
            {value.pairLabel ? (
              <span
                className="
                  flex
                  h-[22px]
                  items-center
                  justify-center
                  rounded-full
                  bg-black/40
                  px-2
                  text-[11px]
                  font-bold
                  text-white/95
                "
              >
                {value.pairLabel}
              </span>
            ) : null}
          </div>

          {/* Receipt (white paper) — settlement amount + trade context */}
          <div
            className="
              absolute
              left-[12%]
              right-[12%]
              flex
              flex-col
              items-center
              justify-center
              gap-[3px]
            "
            style={{ top: '63.5%', height: '17%' }}
          >
            <span
              className="font-mono text-[20px] font-extrabold leading-tight"
              style={{ color: tone.accent }}
            >
              {value.amount}
            </span>
            <span className="text-center text-[10.5px] font-medium leading-tight text-[#A7AEBB]">
              {value.detail}
            </span>
            {value.meta ? (
              <span className="text-center text-[10px] leading-tight text-[#B6BCC7]">
                {value.meta}
              </span>
            ) : null}
          </div>

          {/* Footer — auto-close note + confirm glyph (Lotto layout) */}
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
            style={{ top: '90%' }}
          >
            <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white">
              <Check size={11} strokeWidth={3.2} style={{ color: tone.accent }} />
            </span>
            <span className="text-[11.5px] font-semibold text-white/95">
              {autoCloseSeconds} seconds auto close
            </span>
          </div>
        </div>
      </div>

      {/* Round X close button below the card (Lotto layout) */}
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
  );
}

// ============================================================
// COMPONENT
// ============================================================

export default function WinLossPopup({
  value,
  onClose,
  embedded = false,
}: {
  value: WinLossPopupData | null;
  onClose: () => void;
  /**
   * When true the modal is positioned `absolute` so it is confined to the
   * nearest `position: relative` parent (e.g. the Lotto Pick Number panel).
   * Default false keeps the original full-viewport `fixed` modal (Pulse).
   */
  embedded?: boolean;
}) {
  // Always call hooks unconditionally.
  useEffect(() => {
    if (!value) {
      return;
    }

    const timer = window.setTimeout(
      onClose,
      WIN_LOSS_POPUP_AUTO_CLOSE_MS,
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [value?.id, onClose]);

  if (!value) {
    return null;
  }

  // ----------------------------------------------------------
  // PULSE TRADE MOVEMENT CARD
  // ----------------------------------------------------------
  // When the resolver mapped a finalized WIN/LOSS to a movement
  // card, the whole popup becomes the Lotto-style frame card:
  // up.png/down.webp tinted GREEN (win) / RED (loss) with the
  // result text + settlement amount over the art.
  // DRAW and legacy callers keep the dark card below, unchanged.
  // ----------------------------------------------------------
  if (value.movement === 'UP' || value.movement === 'DOWN') {
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
          backdrop-blur-sm
          animate-[winlossFadeIn_0.2s_ease-out]
        `}
        role="dialog"
        aria-modal="true"
        aria-label={`${OUTCOME_LABEL[value.outcome]} result`}
        onClick={(event) => {
          // Click on the backdrop closes the popup.
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <style>{WINLOSS_KEYFRAMES}</style>
        <PulseResultFrameCard value={value} onClose={onClose} />
      </div>
    );
  }

  const style = OUTCOME_STYLES[value.outcome];

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
        backdrop-blur-sm
        animate-[winlossFadeIn_0.2s_ease-out]
      `}
      role="dialog"
      aria-modal="true"
      aria-label={`${OUTCOME_LABEL[value.outcome]} result`}
      onClick={(event) => {
        // Click on the backdrop closes the popup.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`
          w-[340px]
          max-w-[92vw]
          overflow-hidden
          rounded-[24px]
          border
          ${style.border}
          bg-[#1B1917]
          shadow-[0_24px_80px_rgba(0,0,0,0.55)]
          animate-[winlossPopIn_0.25s_ease-out]
        `}
      >
        {/* Accent strip */}
        <div className={`h-2 ${style.accent}`} />

        <div className="px-5 py-6 text-center">
          {/* Status chip */}
          <span
            className="
              mb-4
              inline-flex
              items-center
              gap-1.5
              rounded-full
              border
              border-white/10
              bg-white/5
              px-3
              py-1
              text-[11px]
              font-extrabold
              uppercase
              tracking-[0.08em]
              text-white/80
            "
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.accent}`} />
            {OUTCOME_LABEL[value.outcome]}
          </span>

          {/* Icon — legacy/Lotto behaviour unchanged. Pulse WIN/LOSS is
              rendered by the movement frame card branch above. */}
          <div
            className={`
              mx-auto
              mt-4
              flex
              h-20
              w-20
              items-center
              justify-center
              rounded-full
              ${style.iconBg}
            `}
          >
            <style>{WINLOSS_KEYFRAMES}</style>

            {value.outcome === 'win' ? (
              <PartyPopper
                size={30}
                className={style.iconColor}
              />
            ) : (
              <style.Icon
                size={38}
                className={style.iconColor}
              />
            )}
          </div>

          {/* Title */}
          <h3
            className="
              mt-4
              text-[20px]
              font-black
              text-white
            "
          >
            {value.title}
          </h3>

          {/* Detail */}
          <p
            className="
              mt-1
              text-[12px]
              font-medium
              text-white/60
            "
          >
            {value.detail}
          </p>

          {/* Amount */}
          <p
            className={`
              mt-4
              text-[28px]
              font-black
              font-mono
              ${style.amountColor}
            `}
          >
            {value.amount}
          </p>

          {/* Meta */}
          {value.meta && (
            <p
              className="
                mt-1
                text-[11.5px]
                text-white/50
              "
            >
              {value.meta}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4">
          <span
            className="
              text-[10px]
              font-semibold
              text-white/40
            "
          >
            Auto-closes shortly
          </span>

          <button
            type="button"
            onClick={onClose}
            className="
              flex
              items-center
              gap-1.5
              rounded-full
              border
              border-white/15
              bg-white/5
              px-3.5
              py-2
              text-[12px]
              font-bold
              text-white/80
              transition
              hover:bg-[#20202A]/10
              hover:text-white
            "
          >
            <X size={13} />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}