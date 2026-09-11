// src/marketplace/games/lotto/components/BetControls.jsx

import React from 'react';
import { Minus, Plus } from 'lucide-react';

const QUICK_AMOUNTS = [10, 50, 100, 250, 500];

const BetControls = ({
  betAmount,
  minBet = 1,
  maxBet = 100000,
  onBetAmountChange,
  disabled,
}) => {
  const value = Number(betAmount) || 0;

  const clamp = (n) => Math.min(maxBet, Math.max(minBet, n));

  const handleDecrease = () => {
    if (disabled) return;
    onBetAmountChange(clamp(value - 10));
  };

  const handleIncrease = () => {
    if (disabled) return;
    onBetAmountChange(clamp(value + 10));
  };

  const handleInput = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    if (raw === '') return onBetAmountChange('');
    onBetAmountChange(clamp(Number(raw)));
  };

  const handleQuick = (amt) => {
    if (disabled) return;
    onBetAmountChange(clamp(amt));
  };

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      {/* Top row: label + min/max */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black text-[#0F172A]">
            Ticket Amount
          </span>
          <span className="rounded-md bg-[#FEF3C7] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#B45309]">
            TDX
          </span>
        </div>
        <span className="text-[10px] font-semibold text-[#94A3B8]">
          Min {minBet} · Max {maxBet}
        </span>
      </div>

      {/* Middle row: minus | input | plus | selected amount */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleDecrease}
          disabled={disabled || value <= minBet}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] shadow-sm transition-all hover:bg-[#F1F5F9] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease amount"
        >
          <Minus size={16} strokeWidth={3} />
        </button>

        <div className="flex h-10 flex-1 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
          <input
            type="text"
            inputMode="numeric"
            value={betAmount}
            onChange={handleInput}
            disabled={disabled}
            className="w-full bg-transparent text-center text-sm font-black text-[#0F172A] tabular-nums outline-none disabled:opacity-50"
          />
        </div>

        <button
          type="button"
          onClick={handleIncrease}
          disabled={disabled || value >= maxBet}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] shadow-sm transition-all hover:bg-[#F1F5F9] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase amount"
        >
          <Plus size={16} strokeWidth={3} />
        </button>

        {/* Selected Amount pill */}
        <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#FDE68A] bg-gradient-to-r from-[#FFFBEB] to-[#FEF3C7] px-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#92400E]">
            Selected
          </span>
          <span className="text-sm font-black text-[#78350F] tabular-nums">
            {Number(betAmount || 0).toLocaleString('en-US')}
          </span>
          <span className="rounded bg-[#FBBF24] px-1 py-0.5 text-[8px] font-black text-[#78350F]">
            TDX
          </span>
        </div>
      </div>

      {/* Quick select row */}
      <div className="mt-3">
        <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
          Quick Select
        </p>
        <div className="grid grid-cols-5 gap-2">
          {QUICK_AMOUNTS.map((amt) => {
            const active = value === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => handleQuick(amt)}
                disabled={disabled}
                className={`
                  h-9 rounded-lg text-[11px] font-black tabular-nums
                  transition-all active:scale-95
                  ${
                    active
                      ? 'border border-[#F59E0B] bg-gradient-to-b from-[#FFD54D] to-[#F5B800] text-[#181205] shadow-sm'
                      : 'border border-[#E2E8F0] bg-white text-[#475569] shadow-sm hover:bg-[#F1F5F9]'
                  }
                  disabled:cursor-not-allowed disabled:opacity-40
                `}
              >
                {amt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default BetControls;