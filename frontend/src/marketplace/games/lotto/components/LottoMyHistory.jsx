// src/marketplace/games/lotto/components/LottoMyHistory.jsx
// User's own ticket history, card-wise. Each card shows period, ticket
// number, selected numbers, placed time, ticket amount, and win/loss outcome
// with status symbol.

import React from 'react';

import {
  CheckCircle2,
  Clock,
  Crown,
  RefreshCw,
  Ticket as TicketIcon,
  XCircle,
} from 'lucide-react';

import { formatTdx, formatDateTime } from '../utils/lottoPresentation';
import { deriveTicketOutcomeStatus } from '../utils/lottoState';
import { shortenId, symbolGroupTone } from '../utils/lottoUi';

const STATUS_CONFIG = {
  WIN: { label: 'WIN', tone: 'bg-[#0C2417] text-[#4ADE80] border-[#1E4A32]', Icon: CheckCircle2 },
  LOSS: { label: 'LOSS', tone: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]', Icon: XCircle },
  SETTLED: { label: 'SETTLED', tone: 'bg-[#1C1C24] text-[#C5C6D0] border-[#34343E]', Icon: CheckCircle2 },
  REFUNDED: { label: 'REFUNDED', tone: 'bg-[#2A1608] text-[#FDBA74] border-[#3A2410]', Icon: RefreshCw },
  CANCELLED: { label: 'CANCELLED', tone: 'bg-[#2A1515] text-[#F87171] border-[#4A2323]', Icon: XCircle },
  ACTIVE: { label: 'ACTIVE', tone: 'bg-[#0F1C30] text-[#818CF8] border-[#26315C]', Icon: Clock },
  CUTOFF: { label: 'CUTOFF', tone: 'bg-[#291A0B] text-[#FB923C] border-[#3A2410]', Icon: Clock },
  PENDING: { label: 'PENDING', tone: 'bg-[#0F1C30] text-[#818CF8] border-[#26315C]', Icon: Clock },
};

const getPnl = (ticket) => {
  if (!ticket) return null;
  // WIN/LOSS is derived (SETTLED + payout → WIN, SETTLED + no payout → LOSS)
  // so a settled ticket never shows an ambiguous "SETTLED" outcome.
  const status = deriveTicketOutcomeStatus(ticket.status, ticket.winAmount);
  const amount = Number(ticket.amount || 0);
  const winAmount = Number(ticket.winAmount || 0);

  if (status === 'WIN') {
    // Total amount received on winning (full payout, not just the profit).
    return { text: `+${formatTdx(winAmount)} TDX`, tone: 'text-[#4ADE80]' };
  }
  if (status === 'LOSS') {
    return amount > 0
      ? { text: `-${formatTdx(amount)} TDX`, tone: 'text-[#F87171]' }
      : { text: 'LOSS', tone: 'text-[#F87171]' };
  }
  if (status === 'REFUNDED') {
    return {
      text: `Refunded ${formatTdx(winAmount > 0 ? winAmount : amount)} TDX`,
      tone: 'text-[#FDBA74]',
    };
  }
  return { text: 'Pending', tone: 'text-[#818CF8]' };
};

const LottoMyHistory = ({
  history,
  historyLoading,
  embedded,
  pagination,
}) => {
  const tickets = Array.isArray(history) ? history : [];

  return (
    <section className={`lotto-rise lotto-rise--d4 ${embedded ? '' : 'lotto-card lotto-card--pad'}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#F5F5F7]">
          <TicketIcon size={15} strokeWidth={2.4} className="text-[#7C3AED]" />
          My History
        </h3>
        <span className="rounded-lg bg-[#1C1C24] px-2 py-1 text-[10px] font-bold text-[#9A9BA8] tabular-nums">
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Cards */}
      {tickets.length > 0 ? (
        <div className="mt-3 space-y-2">
          {tickets.map((ticket) => {
            // Display status is DERIVED (settled tickets resolve to WIN/LOSS)
            // so every settled card shows a clear win/loss outcome.
            const statusKey = deriveTicketOutcomeStatus(
              ticket.status,
              ticket.winAmount,
            );
            const statusConfig = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.PENDING;
            const pnl = getPnl(ticket);
            const selectedNumbers = Array.isArray(ticket.selectedNumbers)
              ? ticket.selectedNumbers
              : [];
            const periodLabel = ticket.roundNumber ?? ticket.period ?? ticket.id ?? '—';
            const ticketNumber = ticket.ticketNumber ?? `LOTTO-${ticket.id ?? '—'}`;

            return (
              <div
                key={ticket.id}
                className="rounded-xl border border-[#26262E] bg-[#16161C] p-3 transition-colors hover:bg-[#16161C]"
              >
                {/* Row 1: Period + Ticket number + Status badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs font-black text-[#7C3AED] tabular-nums">
                      #{periodLabel}
                    </span>
                    <span className="truncate text-[10px] font-medium text-[#7C7D8A] tabular-nums">
                      {shortenId(ticketNumber, 14)}
                    </span>
                  </div>

                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${statusConfig.tone}`}>
                    {statusConfig.Icon && <statusConfig.Icon size={10} strokeWidth={2.6} />}
                    {statusConfig.label}
                  </span>
                </div>

                {/* Row 2: Selected numbers — tinted with the number's ACTUAL
                    colour group (GREEN 0-7 / RED 8-F): the same source the
                    game-history Number column and the result popup use, not
                    the 4-tone digit scheme of the selection grid. */}
                {selectedNumbers.length > 0 && (
                  <div className="mt-2.5 flex min-w-0 flex-wrap gap-1">
                    {selectedNumbers.map((num) => {
                      const tone = symbolGroupTone(num);
                      return (
                        <span
                          key={num}
                          className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-1.5 text-[11px] font-black"
                          style={
                            tone
                              ? {
                                  color: tone,
                                  borderColor: `${tone}73`,
                                  backgroundColor: `${tone}1F`,
                                }
                              : {
                                  color: '#9A9BA8',
                                  borderColor: '#26262E',
                                  backgroundColor: '#101014',
                                }
                          }
                        >
                          {num}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Row 3: Time + ticket amount + PnL */}
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#1C1C24] pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-[#7C7D8A]">
                      {ticket.createdAt ? formatDateTime(ticket.createdAt) : '—'}
                    </span>
                    <span className="text-[10px] font-bold text-[#9A9BA8]">
                      Ticket: <span className="text-xs font-black text-[#F5F5F7] tabular-nums">{formatTdx(ticket.amount)} TDX</span>
                    </span>
                  </div>
                  {pnl && (
                    <span className={`text-xs font-black tabular-nums ${pnl.tone}`}>
                      {pnl.text}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {pagination}
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#34343E] py-10 text-center">
          <Crown size={28} strokeWidth={1.6} className="text-[#7C7D8A]" />
          <p className="mt-2 text-xs font-bold text-[#9A9BA8]">No tickets yet</p>
          <p className="mt-1 text-[10px] text-[#7C7D8A]">
            Pick your numbers and place the first ticket
          </p>
        </div>
      )}
    </section>
  );
};

export default LottoMyHistory;