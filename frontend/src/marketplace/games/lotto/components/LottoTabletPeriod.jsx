// src/marketplace/games/lotto/components/LottoTabletPeriod.jsx

import React from 'react';
import { Clock } from 'lucide-react';

const LottoTabletPeriod = ({
  activeRound,
  remainingSeconds,
  phase,
  selectedNumbers = [],
}) => {
  const formatTime = (s) => {
    const sec = Math.max(0, Number(s) || 0);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${m}:${ss}`;
  };

  const selectedCount = selectedNumbers.length;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* LEFT: LIVE PERIOD + round number + selected numbers */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#22C55E] shadow-[0_0_0_3px_rgba(34,197,94,0.15)]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
              Live Period
            </span>
          </div>

          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-sm font-black text-[#0F172A] tabular-nums">
              {activeRound?.roundNumber || '—'}
            </span>

            {selectedCount > 0 && (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
                  Selected
                </span>
                <span className="truncate text-[11px] font-black text-[#0F172A] tabular-nums">
                  {selectedNumbers.join(' ')}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* RIGHT: timer */}
        <div className="flex items-center gap-1.5 shrink-0 rounded-lg bg-white px-2.5 py-1.5 border border-[#E2E8F0] shadow-sm">
          <Clock size={13} strokeWidth={2.6} className="text-[#475569]" />
          <span className="text-sm font-black text-[#0F172A] tabular-nums">
            {formatTime(remainingSeconds)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default LottoTabletPeriod;