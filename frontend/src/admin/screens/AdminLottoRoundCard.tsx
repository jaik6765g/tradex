import React from 'react';
import { Clock, Ticket } from 'lucide-react';
import { statusTone, formatTdx, formatCountdown } from './adminLottoUtils';
import type { AdminLottoCategoryCard } from '../services/adminLotto.service';

const DURATION_LABELS: Record<string, string> = { THIRTY_SEC: '30 SEC', ONE_MIN: '1 MIN', THREE_MIN: '3 MIN', FIVE_MIN: '5 MIN' };

export default function RoundCard({ category, card, onRequestResult }: { category: string; card: AdminLottoCategoryCard | null; onRequestResult: (round: any) => void }) {
  const round = card?.round ?? null;
  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-black text-[#111827]">{DURATION_LABELS[category] ?? category}</span>
        {round && <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusTone(round.status)}`}>{round.status}</span>}
      </div>
      {round ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[#667085]">Period <span className="font-black text-[#111827]">#{round.roundNumber}</span></p>
          <div className="flex items-center gap-2 text-xs text-[#667085]"><Clock size={12}/> {formatCountdown(round.remainingSeconds)}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Tickets</p><p className="font-black text-[#111827]">{card?.tickets ?? 0}</p></div>
            <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Volume</p><p className="font-black text-[#111827]">{formatTdx(card?.volume)} TDX</p></div>
            <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Reserved</p><p className="font-black text-[#111827]">{formatTdx(card?.reservedExposure)} TDX</p></div>
            <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Result</p><p className="font-black text-[#111827]">{round.result ?? '—'}</p></div>
          </div>
          {round.resultSource && <p className="text-[10px] font-semibold text-[#667085]">Source: <span className={round.resultSource === 'ADMIN' ? 'text-[#B54708]' : 'text-[#067647]'}>{round.resultSource}</span></p>}
          {(round.status === 'DRAWING' || round.status === 'CUTOFF') && (
            <button type="button" onClick={() => onRequestResult(round)} className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-[#E4E7EC] text-xs font-bold text-[#475467] hover:bg-[#F9FAFB]">
              <Ticket size={12}/> Set Result
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[#667085]">No active round</p>
      )}
    </div>
  );
}