import React from 'react';
import { Clock, Ticket } from 'lucide-react';
import { statusTone, formatTdx, formatCountdown } from './adminLottoUtils';
import type { AdminLottoCategoryCard } from '../services/adminLotto.service';

const DURATION_LABELS: Record<string, string> = { THIRTY_SEC: '30 SEC', ONE_MIN: '1 MIN', THREE_MIN: '3 MIN', FIVE_MIN: '5 MIN', TEN_MIN: '10 MIN' };

export default function RoundCard({ category, card, onRequestResult }: { category: string; card: AdminLottoCategoryCard | null; onRequestResult: (round: any) => void }) {
  const round = card?.round ?? null;
  return (
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-black text-[#F5F5F7]">{DURATION_LABELS[category] ?? category}</span>
        {round && <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusTone(round.status)}`}>{round.status}</span>}
      </div>
      {round ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[#A1A4AE]">Period <span className="font-black text-[#F5F5F7]">#{round.roundNumber}</span></p>
          <div className="flex items-center gap-2 text-xs text-[#A1A4AE]"><Clock size={12}/> {formatCountdown(round.remainingSeconds)}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Tickets</p><p className="font-black text-[#F5F5F7]">{card?.tickets ?? 0}</p></div>
            <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Volume</p><p className="font-black text-[#F5F5F7]">{formatTdx(card?.volume)} TDX</p></div>
            <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Reserved</p><p className="font-black text-[#F5F5F7]">{formatTdx(card?.reservedExposure)} TDX</p></div>
            <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Result</p><p className="font-black text-[#F5F5F7]">{round.result ?? '—'}</p></div>
          </div>
          {round.lockedResult && !round.result && (
            <p className="flex items-center justify-between rounded-lg border border-[#2A190D] bg-[#2A190D]/40 px-2 py-1 text-[10px] font-bold text-[#FF8F3D]">
              <span>LOCKED RESULT</span>
              <span className="text-sm font-black">{round.lockedResult}</span>
            </p>
          )}
          {round.resultSource && <p className="text-[10px] font-semibold text-[#A1A4AE]">Source: <span className={round.resultSource === 'ADMIN' ? 'text-[#FF8F3D]' : 'text-[#4ADE80]'}>{round.resultSource}</span></p>}
          {(round.status === 'DRAWING' || round.status === 'CUTOFF') && (
            <button type="button" onClick={() => onRequestResult(round)} className="mt-1 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-[#292B33] text-xs font-bold text-[#A1A4AE] hover:bg-[#15161C]">
              <Ticket size={12}/> Set Result
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[#A1A4AE]">No active round</p>
      )}
    </div>
  );
}