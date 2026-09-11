// src/marketplace/games/lotto/components/LottoHeader.jsx

import React from 'react';
import { ArrowLeft, Sparkles, ShieldCheck, Trophy, Zap, Lock } from 'lucide-react';

const LottoHeader = ({ balance, loading, onBack }) => {
  const formatTdx = (value) => {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return '0.00';
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <header className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#1E1B4B] via-[#312E81] to-[#4338CA] px-5 py-4 border border-indigo-500/30 shadow-xl shadow-indigo-900/20">
      {/* Animated glow orbs */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-400/20 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-violet-400/20 blur-3xl" />
      <div className="pointer-events-none absolute right-1/3 top-1/2 h-20 w-20 rounded-full bg-fuchsia-400/10 blur-2xl animate-[pulse_3s_ease-in-out_infinite]" />

      {/* Top row — Back + Title + Balance */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 border border-white/10"
              aria-label="Back to marketplace"
            >
              <ArrowLeft size={15} strokeWidth={2.4} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/30">
              <Trophy size={18} className="text-white" strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white leading-tight">
                Lotto Win
              </h1>
              <p className="text-[10px] font-semibold text-indigo-200/80 uppercase tracking-wider">
                Number Prediction Game
              </p>
            </div>
          </div>
        </div>

        {/* Balance pill */}
        <div className="flex items-center gap-1.5 rounded-xl bg-white/10 backdrop-blur-sm px-3 py-1.5 border border-white/10 shrink-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#FBBF24] to-[#F59E0B]">
            <Zap size={11} className="text-white" strokeWidth={2.5} />
          </div>
          {loading ? (
            <div className="h-4 w-16 animate-pulse rounded bg-white/20" />
          ) : (
            <p className="text-[12px] font-extrabold text-white tabular-nums">
              {formatTdx(balance)} <span className="text-amber-300 text-[10px]">TDX</span>
            </p>
          )}
        </div>
      </div>

      {/* Win-up-to-15x hero badge */}
      <div className="relative mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-pink-500 px-3 py-1 text-[11px] font-black text-white shadow-lg shadow-orange-500/30 animate-[pulse_2s_ease-in-out_infinite]">
            <Sparkles size={11} strokeWidth={2.6} />
            Win up to 15×
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 backdrop-blur-sm px-2.5 py-1 text-[9px] font-bold text-indigo-100 border border-white/10">
            <ShieldCheck size={9} strokeWidth={2.6} className="text-emerald-300" />
            Provably Fair
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 border border-white/10">
          <Lock size={9} className="text-indigo-200" />
          <span className="text-[9px] font-bold text-indigo-200">High Security</span>
        </div>
      </div>
    </header>
  );
};

export default LottoHeader;