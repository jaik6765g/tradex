// ============================================================
// frontend/src/trade/pulse/components/PulseTrade.tsx
// ============================================================

import React, { useMemo } from 'react';

import { RealChart } from './RealChart';
import { usePulseTrade } from '../hooks/usePulseTrade';

import WinLossPopup from '../../../shared/components/WinLossPopup';

import {
  PULSE_MAX_AMOUNT_TDX,
  PULSE_MIN_AMOUNT_TDX,
  PULSE_SUPPORTED_DURATIONS,
} from '../types';

// ============================================================
// QUICK AMOUNTS
// ============================================================

const QUICK_AMOUNTS = [10, 20, 50, 100, 500, 1000];

// ============================================================
// FORMAT HELPERS
// ============================================================

function formatAmount(
    value: string | number | null | undefined,
    decimals = 2,
): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return '-';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numeric);
}

function formatPrice(
    value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '-';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

// ============================================================
// ROBUST DATE PARSER
// ============================================================

function parseDateValue(
    value: string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTradeTime(
    value: string | number | null | undefined,
): string {
  const date = parseDateValue(value);

  if (!date) {
    return '-';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ============================================================
// RESULT
// ============================================================

function normalizeResult(
    value: string | null | undefined,
): string {
  const result = String(value ?? '').trim().toUpperCase();

  if (result === 'WIN' || result === 'WON' || result === 'PROFIT') {
    return 'PROFIT';
  }

  if (result === 'LOSS' || result === 'LOST') {
    return 'LOSS';
  }

  if (result === 'DRAW') {
    return 'DRAW';
  }

  return result || '-';
}

function getResultClass(
    value: string | null | undefined,
): string {
  const result = normalizeResult(value);

  if (result === 'PROFIT') {
    return 'text-[#16A34A]';
  }

  if (result === 'LOSS') {
    return 'text-[#DC2626]';
  }

  if (result === 'DRAW') {
    return 'text-[#D97706]';
  }

  return 'text-[#667085]';
}

// ============================================================
// CHART TRADE TYPE
// ============================================================

export type ChartTrade = {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  amount?: string | number;
  stake?: string | number;
  entryPrice?: string | number;
  expiryPrice?: string | number;
  exitPrice?: string | number;
  settlementPrice?: string | number;
  entryAt?: string | number | null;
  expiresAt?: string | number | null;
  settledAt?: string | number | null;
  createdAt?: string | number | null;
  result?: string;
  status?: string;
  payout?: string | number;
};

// ============================================================
// NORMALIZE TRADE
// ============================================================

function normalizeTrade(
    trade: unknown,
): ChartTrade | null {
  if (!trade || typeof trade !== 'object') {
    return null;
  }

  const raw = trade as Record<string, unknown>;

  const id = String(raw.id ?? '').trim();

  if (!id) {
    return null;
  }

  const rawDirection = String(raw.direction ?? raw.side ?? '').toUpperCase();
  const rawSymbol = String(raw.symbol ?? raw.pair ?? '');

  return {
    id,
    symbol: rawSymbol,
    direction: rawDirection === 'SHORT' ? 'SHORT' : 'LONG',
    amount: raw.amount as string | number | undefined,
    stake: raw.stake as string | number | undefined,
    entryPrice: raw.entryPrice as string | number | undefined,
    expiryPrice: raw.expiryPrice as string | number | undefined,
    exitPrice: raw.exitPrice as string | number | undefined,
    settlementPrice: raw.settlementPrice as string | number | undefined,
    entryAt: (raw.entryAt ?? raw.openedAt ?? raw.createdAt) as string | number | null | undefined,
    expiresAt: (raw.expiresAt ?? raw.expiryAt) as string | number | null | undefined,
    settledAt: (raw.settledAt ?? raw.closedAt) as string | number | null | undefined,
    createdAt: raw.createdAt as string | number | null | undefined,
    result: String(raw.result ?? '').toUpperCase(),
    status: String(raw.status ?? '').toUpperCase(),
    payout: raw.payout as string | number | undefined,
  };
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function PulseTrade() {
  const {
    selectedPair,
    setSelectedPair,
    selectedDuration,
    setSelectedDuration,
    selectedDirection,
    setSelectedDirection,
    amountInput,
    setAmountInput,
    markets,
    openTrades,
    history,
    activeTrade,
    risk,
    message,
    loading,
    placingTrade,
    settlementPopup,
    dismissSettlementPopup,
    walletAvailable,
    placeTrade,
  } = usePulseTrade();

  const normalizedActiveTrade = useMemo(() => normalizeTrade(activeTrade), [activeTrade]);

  const normalizedOpenTrades = useMemo(
      () => openTrades.map(normalizeTrade).filter((trade): trade is ChartTrade => trade !== null),
      [openTrades],
  );

  const normalizedHistory = useMemo(
      () => history.map(normalizeTrade).filter((trade): trade is ChartTrade => trade !== null),
      [history],
  );

  const isSubmitDisabled = placingTrade || loading;

  // ==========================================================
  // HANDLE DIRECTION CLICK (Direct Trade Place)
  // ==========================================================

  const handleLongClick = () => {
    if (isSubmitDisabled) return;
    // Explicitly pass the clicked direction so the trade is
    // always placed for THIS button (no stale-closure mixups).
    setSelectedDirection('LONG');
    void placeTrade('LONG');
  };

  const handleShortClick = () => {
    if (isSubmitDisabled) return;
    setSelectedDirection('SHORT');
    void placeTrade('SHORT');
  };

  // ==========================================================
  // QUICK AMOUNT HANDLER
  // ==========================================================

  const handleQuickAmount = (amount: number) => {
    setAmountInput(String(amount));
  };

  return (
      <div className="min-h-screen bg-[#F8FAFC] px-2 py-2 sm:px-4 sm:py-4">

        {/* Win/Loss settlement popup */}
        <WinLossPopup
          value={settlementPopup}
          onClose={dismissSettlementPopup}
        />

        <div className="mx-auto w-full max-w-7xl space-y-3 sm:space-y-4">

          {/* ==================================================
            REAL-TIME CHART
        ================================================== */}

          <RealChart
              selectedPair={selectedPair}
              markets={markets}
              onPairChange={(pair) => setSelectedPair(pair as typeof selectedPair)}
              pairDisabled={placingTrade}
              interval="1m"
              activeTrade={normalizedActiveTrade}
              openTrades={normalizedOpenTrades}
              history={normalizedHistory}
          />

          {/* ==================================================
            PLACE TRADE CARD (COMPACT)
        ================================================== */}

          <div className="overflow-hidden rounded-2xl border border-[#E9ECF2] bg-white shadow-[0_4px_20px_rgba(16,24,40,0.04)]">

            {/* HEADER */}

            <div className="border-b border-[#EAECF0] px-4 py-2.5 sm:px-5">

              <div className="flex items-center justify-between gap-3">

                <div>

                  <h3 className="text-sm font-bold text-[#101828] sm:text-base">
                    Place Trade
                  </h3>

                  <p className="mt-0.5 text-[10px] text-[#667085] sm:text-xs">
                    Select amount, duration and direction
                  </p>

                </div>

                {/* SMALL BALANCE */}

                <div className="shrink-0 rounded-lg border border-[#EAECF0] bg-[#F9FAFB] px-2.5 py-1.5 text-right">

                  <p className="text-[9px] uppercase tracking-wide text-[#667085]">
                    Balance
                  </p>

                  <p className="text-sm font-bold text-[#101828] sm:text-base">
                    {formatAmount(walletAvailable, 2)}{' '}
                    TDX
                  </p>

                </div>

              </div>

            </div>

            {/* FORM (Vertical Layout) */}

            <div className="p-4 sm:p-5">

              {/* AMOUNT (Top) */}

              <div className="mb-4">

                <label className="text-xs text-[#667085]">
                  Amount (TDX)
                </label>

                <input
                    type="number"
                    min={PULSE_MIN_AMOUNT_TDX}
                    max={PULSE_MAX_AMOUNT_TDX}
                    step="0.00000001"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    disabled={placingTrade}
                    placeholder="Enter amount"
                    className="mt-1 h-11 w-full rounded-xl border border-[#D0D5DD] bg-white px-3 text-sm text-[#101828] outline-none focus:border-[#F5B800] focus:ring-2 focus:ring-[#F5B800]/20"
                />

                {/* QUICK AMOUNTS */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_AMOUNTS.map((amount) => (
                      <button
                          key={amount}
                          type="button"
                          onClick={() => handleQuickAmount(amount)}
                          disabled={placingTrade}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                              amountInput === String(amount)
                                  ? 'bg-[#F5B800] text-[#101828] shadow-[0_2px_6px_rgba(245,184,0,0.3)]'
                                  : 'bg-[#F2F4F7] text-[#667085] hover:bg-[#EAECF0] hover:text-[#101828]'
                          }`}
                      >
                        {amount}
                      </button>
                  ))}
                </div>

              </div>

              {/* DIRECTION (Middle) */}

              <div className="mb-4">

                <p className="mb-1 text-xs text-[#667085]">
                  Direction
                </p>

                <div className="grid grid-cols-2 gap-2">

                  <button
                      type="button"
                      onClick={handleLongClick}
                      disabled={isSubmitDisabled}
                      className={`h-12 rounded-xl text-sm font-bold transition-all ${
                          selectedDirection === 'LONG'
                              ? 'bg-[#16A34A] text-white shadow-[0_4px_15px_rgba(22,163,74,0.4)] ring-2 ring-[#16A34A]/30'
                              : 'bg-[#16A34A]/10 text-[#16A34A] border border-[#16A34A]/40 hover:bg-[#16A34A]/20'
                      }`}
                  >
                    ▲ LONG
                  </button>

                  <button
                      type="button"
                      onClick={handleShortClick}
                      disabled={isSubmitDisabled}
                      className={`h-12 rounded-xl text-sm font-bold transition-all ${
                          selectedDirection === 'SHORT'
                              ? 'bg-[#DC2626] text-white shadow-[0_4px_15px_rgba(220,38,38,0.4)] ring-2 ring-[#DC2626]/30'
                              : 'bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/40 hover:bg-[#DC2626]/20'
                      }`}
                  >
                    ▼ SHORT
                  </button>

                </div>

              </div>

              {/* DURATION (Bottom) */}

              <div className="mb-4">

                <p className="mb-1 text-xs text-[#667085]">
                  Duration
                </p>

                <div className="grid grid-cols-5 gap-1">

                  {PULSE_SUPPORTED_DURATIONS.map((duration) => (
                      <button
                          key={duration}
                          type="button"
                          onClick={() => setSelectedDuration(duration)}
                          disabled={placingTrade}
                          className={`h-10 rounded-lg text-xs font-semibold transition-all ${
                              selectedDuration === duration
                                  ? 'bg-[#F5B800] text-[#101828] shadow-[0_2px_8px_rgba(245,184,0,0.3)]'
                                  : 'bg-[#F2F4F7] text-[#667085] hover:bg-[#EAECF0] hover:text-[#101828]'
                          }`}
                      >
                        {duration}
                      </button>
                  ))}

                </div>

              </div>

              {/* WALLET / RISK */}

              <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-[#667085]">

              <span>
                Wallet: {formatAmount(walletAvailable, 2)} TDX
              </span>

                {risk && (
                    <span>
                  Risk: {String((risk as unknown as Record<string, unknown>).state ?? '-')}
                </span>
                )}

              </div>

              {/* MESSAGE */}

              {message && (
                  <div
                      className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                          message.type === 'error'
                              ? 'bg-red-50 text-[#DC2626]'
                              : message.type === 'success'
                                  ? 'bg-green-50 text-[#16A34A]'
                                  : 'bg-[#F2F4F7] text-[#667085]'
                      }`}
                  >
                    {message.text}
                  </div>
              )}

            </div>

          </div>

          {/* ==================================================
            TRADE HISTORY
        ================================================== */}

          <div className="overflow-hidden rounded-2xl border border-[#E9ECF2] bg-white shadow-[0_4px_20px_rgba(16,24,40,0.04)]">

            {/* HISTORY HEADER */}

            <div className="flex items-center justify-between border-b border-[#EAECF0] px-4 py-3 sm:px-5">

              <div>

                <h3 className="text-sm font-bold text-[#101828] sm:text-base">
                  Trade History
                </h3>

                <p className="mt-0.5 text-[10px] text-[#667085] sm:text-xs">
                  Recently settled Pulse trades
                </p>

              </div>

              <span className="text-xs text-[#667085]">
              {normalizedHistory.length}
            </span>

            </div>

            {/* EMPTY */}

            {normalizedHistory.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-[#98A2B3]">
                  No trade history yet.
                </div>
            ) : (
                <div className="overflow-x-auto">

                  <table className="w-full min-w-[900px] text-xs">

                    <thead className="bg-[#F9FAFB]">

                    <tr className="text-[#667085]">

                      <th className="px-3 py-3 text-left">
                        Pair
                      </th>

                      <th className="px-3 py-3 text-left">
                        Side
                      </th>

                      <th className="px-3 py-3 text-right">
                        Amount
                      </th>

                      <th className="px-3 py-3 text-right">
                        Entry
                      </th>

                      <th className="px-3 py-3 text-right">
                        Exit
                      </th>

                      <th className="px-3 py-3 text-center">
                        Result
                      </th>

                      <th className="px-3 py-3 text-right">
                        Payout
                      </th>

                      <th className="px-3 py-3 text-left">
                        Time
                      </th>

                    </tr>

                    </thead>

                    <tbody>

                    {normalizedHistory.map((trade) => {

                      const result = normalizeResult(trade.result ?? trade.status);

                      const exitPrice = trade.expiryPrice ?? trade.exitPrice ?? trade.settlementPrice;

                      const tradeTime = trade.entryAt ?? trade.settledAt ?? trade.createdAt;

                      const amount = trade.stake ?? trade.amount;

                      return (
                          <tr
                              key={trade.id}
                              className="border-t border-[#F2F4F7] transition-colors hover:bg-[#F9FAFB]"
                          >

                            {/* PAIR */}

                            <td className="whitespace-nowrap px-3 py-4 font-semibold text-[#101828]">
                              {trade.symbol}
                            </td>

                            {/* SIDE */}

                            <td className="whitespace-nowrap px-3 py-4">

                          <span
                              className={
                                trade.direction === 'LONG'
                                    ? 'font-bold text-[#16A34A]'
                                    : 'font-bold text-[#DC2626]'
                              }
                          >
                            {trade.direction === 'LONG' ? '▲ LONG' : '▼ SHORT'}
                          </span>

                            </td>

                            {/* AMOUNT */}

                            <td className="whitespace-nowrap px-3 py-4 text-right font-mono text-[#101828]">
                              {formatAmount(amount, 2)} TDX
                            </td>

                            {/* ENTRY */}

                            <td className="whitespace-nowrap px-3 py-4 text-right font-mono text-[#101828]">
                              {formatPrice(trade.entryPrice)}
                            </td>

                            {/* EXIT */}

                            <td className="whitespace-nowrap px-3 py-4 text-right font-mono text-[#101828]">
                              {formatPrice(exitPrice)}
                            </td>

                            {/* RESULT */}

                            <td className="whitespace-nowrap px-3 py-4 text-center">

                          <span
                              className={`font-bold ${getResultClass(trade.result ?? trade.status)}`}
                          >
                            {result}
                          </span>

                            </td>

                            {/* PAYOUT */}

                            <td className="whitespace-nowrap px-3 py-4 text-right font-mono text-[#101828]">
                              {formatAmount(trade.payout, 2)} TDX
                            </td>

                            {/* TIME */}

                            <td className="whitespace-nowrap px-3 py-4 text-[#667085]">
                              {formatTradeTime(tradeTime)}
                            </td>

                          </tr>
                      );
                    })}

                    </tbody>

                  </table>

                </div>
            )}

          </div>

        </div>

      </div>
  );
}