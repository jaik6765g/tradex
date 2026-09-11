// src/marketplace/games/lotto/components/LottoTicket.jsx
// Premium "ticket placed" receipt shown after a successful purchase.
// Renders a normalized ticket from useLottoGame (latestTicket) and never
// mutates state — pure presentation, dismissible by the parent.

import React from 'react';

import { CircleCheck } from 'lucide-react';

import { formatTdx } from '../utils/lottoPresentation';
import { shortenId, symbolToneClassName } from '../utils/lottoUi';

const LottoTicket = ({ ticket, onDismiss }) => {
  if (!ticket) {
    return null;
  }

  const numbers = Array.isArray(ticket.selectedNumbers)
    ? ticket.selectedNumbers
    : [];

  return (
    <div className="lotto-receipt" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="lotto-receipt-stamp">
          <CircleCheck size={12} strokeWidth={2.8} />
          Ticket Placed
        </span>
        <span className="flex items-center gap-2">
          <span className="lotto-receipt-id">
            #{shortenId(ticket.id ?? ticket.roundNumber ?? 'ticket', 16)}
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss ticket receipt"
              className="rounded-md px-1 text-[10px] font-bold text-[#5f6c9e] transition-colors hover:text-[#111827]"
            >
              ✕
            </button>
          )}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {numbers.length > 0 ? (
            numbers.map((num) => (
              <span key={num} className={`lotto-receipt-num ${symbolToneClassName(num)}`}>
                {num}
              </span>
            ))
          ) : (
            <span className="text-[11px] font-medium text-[#5f6c9e]">No numbers</span>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-bold text-[#667085]">
            {ticket.roundNumber || '—'}
          </p>
          <p className="text-xs font-black text-[#0F172A]">
            {formatTdx(ticket.amount)} TDX
          </p>
        </div>
      </div>
    </div>
  );
};

export default LottoTicket;