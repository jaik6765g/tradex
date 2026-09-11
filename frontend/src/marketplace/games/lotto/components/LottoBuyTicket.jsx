// src/marketplace/games/lotto/components/LottoBuyTicket.jsx

import React from 'react';

import { CircleAlert, Info, Ticket, Wallet, Trophy } from 'lucide-react';

import { formatTdx } from '../utils/lottoPresentation';
import { TIMER_PHASE } from '../utils/lottoTimer';

import BetControls from './BetControls';
import LottoTabletPeriod from './LottoTabletPeriod';
import LottoTicket from './LottoTicket';

const LottoBuyTicket = ({
  activeRound,
  selectedNumbers,
  betAmount,
  setBetAmount,
  balance,
  disabled,
  submitting,
  isAuthenticated,
  error,
  selectionError,
  latestTicket,
  onPlaceTicket,
  remainingSeconds,
  timerPhase,
}) => {
  const selectedCount = selectedNumbers.length;
  const totalPayable = Number(betAmount || 0);
  const insufficientBalance = Number(balance) < totalPayable;

  // Real backend payout formula (LOTTO-01 frozen rules):
  //   netAmount = amount × 0.97  (3% deduction)
  //   multiplier = 16 / selectionCount
  //   potentialWin = netAmount × multiplier, rounded to 2 decimals
  const canComputeWin = selectedCount > 0 && totalPayable > 0;
  const potentialWin = canComputeWin
    ? Number(
        (totalPayable * 0.97 * (16 / selectedCount)).toFixed(2),
      )
    : 0;
  const canPlace =
    isAuthenticated &&
    !disabled &&
    selectedCount > 0 &&
    totalPayable > 0 &&
    !insufficientBalance;

  return (
    <section className="lotto-card lotto-card--pad lotto-rise lotto-rise--d3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-black text-[#0F172A]">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FEF3C7]">
              <Ticket size={15} strokeWidth={2.4} className="text-[#B45309]" />
            </span>
            Buy Ticket
          </h3>
          <p className="mt-1 text-[11px] font-medium text-[#64748B]">
            Debited from the main TDX wallet
          </p>
        </div>

        <div
          className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5"
          title="Main TDX wallet balance"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-[#475569] shadow-sm">
            <Wallet size={13} strokeWidth={2.4} />
          </span>
          <span className="leading-tight">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
              Balance
            </span>
            <span className="block text-[11px] font-black text-[#0F172A] tabular-nums">
              {formatTdx(balance)} TDX
            </span>
          </span>
        </div>
      </div>

      {/* Live period + Selected numbers */}
      <div className="mt-3.5">
        <LottoTabletPeriod
          activeRound={activeRound}
          remainingSeconds={remainingSeconds}
          phase={timerPhase}
          selectedNumbers={selectedNumbers}
        />
      </div>

      {/* Amount stepper */}
      <div className="mt-4">
        <BetControls
          betAmount={betAmount}
          minBet={1}
          maxBet={100000}
          onBetAmountChange={setBetAmount}
          disabled={disabled}
        />
      </div>

      {/* ✅ Potential Win — real payout from frozen LOTTO-01 formula */}
      <p className="mt-3 flex items-center justify-end gap-1 text-[11px] font-bold text-[#15803D]">
        <Trophy size={12} strokeWidth={2.6} />
        {selectedCount > 0 ? `${formatTdx(potentialWin)} TDX` : '—'}
      </p>

      {/* Alerts */}
      {selectionError && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[11px] font-semibold text-[#B91C1C]"
          role="alert"
        >
          <CircleAlert size={14} strokeWidth={2.6} className="mt-px shrink-0" />
          <span>{selectionError}</span>
        </div>
      )}

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[11px] font-semibold text-[#B91C1C]"
          role="alert"
        >
          <CircleAlert size={14} strokeWidth={2.6} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!isAuthenticated && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2.5 text-[11px] font-semibold text-[#1D4ED8]"
          role="status"
        >
          <Info size={14} strokeWidth={2.6} className="mt-px shrink-0" />
          <span>Connect your wallet to place a ticket.</span>
        </div>
      )}

      {insufficientBalance && isAuthenticated && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[11px] font-semibold text-[#B91C1C]"
          role="alert"
        >
          <CircleAlert size={14} strokeWidth={2.6} className="mt-px shrink-0" />
          <span>Insufficient balance in the main TDX wallet.</span>
        </div>
      )}

      {/* Success receipt */}
      {latestTicket && !submitting && (
        <div className="mt-3.5">
          <LottoTicket ticket={latestTicket} />
        </div>
      )}

      {/* CTA */}
      <button
        type="button"
        disabled={!canPlace}
        onClick={onPlaceTicket}
        className={`
          mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-xl
          text-sm font-black uppercase tracking-wider text-[#181205]
          transition-all duration-200
          disabled:cursor-not-allowed disabled:opacity-50
          enabled:hover:-translate-y-0.5
        `}
        style={{
          background: 'linear-gradient(135deg, #FFD54D, #F5B800)',
          boxShadow: canPlace
            ? '0 8px 22px rgba(245,184,0,0.30)'
            : '0 4px 12px rgba(245,184,0,0.15)',
        }}
      >
        {submitting && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-[#181205] border-t-transparent"
            aria-hidden
          />
        )}
        <Ticket size={16} strokeWidth={2.4} />
        {submitting
          ? 'Placing Ticket…'
          : timerPhase === TIMER_PHASE.AWAITING_NEXT
          ? 'Loading Next Round…'
          : timerPhase === TIMER_PHASE.DRAWING
          ? 'Draw In Progress…'
          : 'Buy Ticket'}
      </button>
    </section>
  );
};

export default LottoBuyTicket;