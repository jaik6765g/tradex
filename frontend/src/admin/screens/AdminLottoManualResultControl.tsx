import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import { RESULT_SYMBOLS } from './adminLottoUtils';

interface ManualRound {
  id: number;
  roundNumber: string;
  category?: string | null;
  status: string;
}

export default function ManualResultControl({ rounds, onConfirm }: { rounds: ManualRound[]; onConfirm: (round: ManualRound, symbol: string) => void }) {
  const [selectedRound, setSelectedRound] = useState<number | ''>('');
  const [symbol, setSymbol] = useState('0');
  const eligible = rounds.filter((r) => r.status === 'DRAWING' || r.status === 'CUTOFF' || r.status === 'OPEN');

  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#B54708]"/><h3 className="text-sm font-black text-[#111827]">Manual Result Control</h3></div>
      <p className="mt-0.5 text-xs text-[#667085]">Select a result (0–F) for an eligible round. The backend validates and locks the result. Source becomes ADMIN.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[160px]">
          <p className="text-[10px] font-bold text-[#667085]">Round</p>
          <select value={selectedRound} onChange={(e) => setSelectedRound(e.target.value ? Number(e.target.value) : '')} className="mt-1 h-9 w-full rounded-lg border border-[#E4E7EC] px-2 text-xs">
            <option value="">Select a round…</option>
            {eligible.map((r) => <option key={r.id} value={r.id}>#{r.roundNumber} ({r.category}) — {r.status}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#667085]">Result</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {RESULT_SYMBOLS.map((s) => (
              <button key={s} type="button" onClick={() => setSymbol(s)} className={`h-9 w-9 rounded-lg border text-xs font-black ${symbol === s ? 'border-[#F5B800] bg-[#FFFAEB] text-[#B54708]' : 'border-[#E4E7EC] text-[#475467] hover:bg-[#F9FAFB]'}`}>{s}</button>
            ))}
          </div>
        </div>
        <button type="button" disabled={!selectedRound} onClick={() => { const r = eligible.find((x) => x.id === selectedRound); if (r) onConfirm(r, symbol); }} className="flex h-9 items-center gap-1 rounded-lg bg-[#F5B800] px-3 text-xs font-black text-[#181205] disabled:opacity-50"><CheckCircle2 size={14}/> Confirm Result</button>
      </div>
    </div>
  );
}