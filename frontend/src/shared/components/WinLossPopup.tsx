// ============================================================
// frontend/src/shared/components/WinLossPopup.tsx
// ============================================================
// Shared settlement popup used by LOTTO and Pulse Trade.
// Renders a centered modal whenever a bet/trade settles with a
// WIN / LOSS / DRAW outcome. Auto-dismisses after AUTO_CLOSE_MS.
// ============================================================

import React, { useEffect } from 'react';

import {
  Minus,
  PartyPopper,
  TrendingDown,
  Trophy,
  X,
} from 'lucide-react';

export const WIN_LOSS_POPUP_AUTO_CLOSE_MS = 6000;

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
    iconBg: 'bg-[#DCFCE7]',
    iconColor: 'text-[#16A34A]',
    amountColor: 'text-[#16A34A]',
    Icon: Trophy,
  },
  loss: {
    accent: 'bg-[#EF4444]',
    border: 'border-[#FECACA]',
    iconBg: 'bg-[#FEF2F2]',
    iconColor: 'text-[#DC2626]',
    amountColor: 'text-[#DC2626]',
    Icon: TrendingDown,
  },
  draw: {
    accent: 'bg-[#F59E0B]',
    border: 'border-[#FDE68A]',
    iconBg: 'bg-[#FFFBEB]',
    iconColor: 'text-[#D97706]',
    amountColor: 'text-[#D97706]',
    Icon: Minus,
  },
};

const OUTCOME_LABEL: Record<WinLossPopupData['outcome'], string> = {
  win: 'WIN',
  loss: 'LOSS',
  draw: 'DRAW',
};

// ============================================================
// COMPONENT
// ============================================================

export default function WinLossPopup({
  value,
  onClose,
}: {
  value: WinLossPopupData | null;
  onClose: () => void;
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

  const style = OUTCOME_STYLES[value.outcome];

  return (
    <div
      className="
        fixed
        inset-0
        z-[95]
        flex
        items-center
        justify-center
        bg-black/60
        backdrop-blur-sm
        animate-[winlossFadeIn_0.2s_ease-out]
      "
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
          bg-[#0B1220]
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

          {/* Icon */}
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
            <style>{`
              @keyframes winlossFadeIn {
                from { opacity: 0; }
                to   { opacity: 1; }
              }
              @keyframes winlossPopIn {
                from { transform: scale(0.92); opacity: 0; }
                to   { transform: scale(1); opacity: 1; }
              }
            `}</style>

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
              hover:bg-white/10
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