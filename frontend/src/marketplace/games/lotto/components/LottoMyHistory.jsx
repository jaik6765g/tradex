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
import {
  shortenId,
  symbolToneClassName,
} from '../utils/lottoUi';

const STATUS_CONFIG = {
  WIN: { label: 'WIN', tone: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]', Icon: CheckCircle2 },
  LOSS: { label: 'LOSS', tone: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]', Icon: XCircle },
  SETTLED: { label: 'SETTLED', tone: 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]', Icon: CheckCircle2 },
  REFUNDED: { label: 'REFUNDED', tone: 'bg-[#FFF6ED] text-[#C4320A] border-[#FDDCAB]', Icon: RefreshCw },
  CANCELLED: { label: 'CANCELLED', tone: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]', Icon: XCircle },
  ACTIVE: { label: 'ACTIVE', tone: 'bg-[#EEF4FF] text-[#3538CD] border-[#C7D7FE]', Icon: Clock },
  CUTOFF: { label: 'CUTOFF', tone: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]', Icon: Clock },
  PENDING: { label: 'PENDING', tone: 'bg-[#EEF4FF] text-[#3538CD] border-[#C7D7FE]', Icon: Clock },
};

const getPnl = (ticket) => {
  if (!ticket) return null;
  const status = String(ticket.status || '').toUpperCase();
  const amount = Number(ticket.amount || 0);
  const winAmount = Number(ticket.winAmount || 0);

  if (status === 'WIN') {
    return {
      text: `+${formatTdx(winAmount - amount)} TDX`,
      tone: 'text-[#067647]',
    };
  }
  if (status === 'LOSS') {
    return {
      text: `-${formatTdx(amount)} TDX`,
      tone: 'text-[#B42318]',
    };
  }
  if (status === 'REFUNDED') {
    return {
      text: `Refunded ${formatTdx(winAmount > 0 ? winAmount : amount)} TDX`,
      tone: 'text-[#C4320A]',
    };
  }
  if (status === 'SETTLED') {
    if (winAmount > 0) {
      return {
        text: `+${formatTdx(winAmount - amount)} TDX`,
        tone: 'text-[#067647]',
      };
    }
    return { text: 'Settled', tone: 'text-[#667085]' };
  }
  return { text: 'Pending', tone: 'text-[#3538CD]' };
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
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#111827]">
          <TicketIcon size={15} strokeWidth={2.4} className="text-[#7C3AED]" />
          My History
        </h3>
        <span className="rounded-lg bg-[#F2F4F7] px-2 py-1 text-[10px] font-bold text-[#667085] tabular-nums">
          {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Cards */}
      {tickets.length > 0 ? (
        <div className="mt-3 space-y-2">
          {tickets.map((ticket) => {
            const statusKey = String(ticket.status || '').toUpperCase();
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
                className="rounded-xl border border-[#E5E7EB] bg-white p-3 transition-colors hover:bg-[#F9FAFB]"
              >
                {/* Row 1: Period + Ticket number + Status badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs font-black text-[#7C3AED] tabular-nums">
                      #{periodLabel}
                    </span>
                    <span className="truncate text-[10px] font-medium text-[#98A2B3] tabular-nums">
                      {shortenId(ticketNumber, 14)}
                    </span>
                  </div>

                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${statusConfig.tone}`}>
                    {statusConfig.Icon && <statusConfig.Icon size={10} strokeWidth={2.6} />}
                    {statusConfig.label}
                  </span>
                </div>

                {/* Row 2: Selected numbers with colors */}
                {selectedNumbers.length > 0 && (
                  <div className="mt-2.5 flex min-w-0 flex-wrap gap-1">
                    {selectedNumbers.map((num) => (
                      <span
                        key={num}
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-1.5 text-[11px] font-black ${symbolToneClassName(num)}`}
                      >
                        {num}
                      </span>
                    ))}
                  </div>
                )}

                {/* Row 3: Time + ticket amount + PnL */}
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#F3F4F6] pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-[#98A2B3]">
                      {ticket.createdAt ? formatDateTime(ticket.createdAt) : '—'}
                    </span>
                    <span className="text-[10px] font-bold text-[#667085]">
                      Ticket: <span className="text-xs font-black text-[#111827] tabular-nums">{formatTdx(ticket.amount)} TDX</span>
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
        <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D0D5DD] py-10 text-center">
          <Crown size={28} strokeWidth={1.6} className="text-[#98A2B3]" />
          <p className="mt-2 text-xs font-bold text-[#667085]">No tickets yet</p>
          <p className="mt-1 text-[10px] text-[#98A2B3]">
            Pick your numbers and place the first ticket
          </p>
        </div>
      )}
    </section>
  );
};

export default LottoMyHistory;