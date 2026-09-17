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
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#FF8F3D]"/><h3 className="text-sm font-black text-[#F5F5F7]">Manual Result Control</h3></div>
      <p className="mt-0.5 text-xs text-[#A1A4AE]">Pick a result (0–F) for a round. Before the draw time the symbol is LOCKED and applied exactly at draw time (the round keeps accepting bets until its cutoff). After the draw time it is finalized immediately. Source becomes ADMIN and every change is audited.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[160px]">
          <p className="text-[10px] font-bold text-[#A1A4AE]">Round</p>
          <select value={selectedRound} onChange={(e) => setSelectedRound(e.target.value ? Number(e.target.value) : '')} className="mt-1 h-9 w-full rounded-lg border border-[#292B33] px-2 text-xs">
            <option value="">Select a round…</option>
            {eligible.map((r) => <option key={r.id} value={r.id}>#{r.roundNumber} ({r.category}) — {r.status}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#A1A4AE]">Result</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {RESULT_SYMBOLS.map((s) => (
              <button key={s} type="button" onClick={() => setSymbol(s)} className={`h-9 w-9 rounded-lg border text-xs font-black ${symbol === s ? 'border-[#FF7A18] bg-[#2A190D] text-[#FF8F3D]' : 'border-[#292B33] text-[#A1A4AE] hover:bg-[#15161C]'}`}>{s}</button>
            ))}
          </div>
        </div>
        <button type="button" disabled={!selectedRound} onClick={() => { const r = eligible.find((x) => x.id === selectedRound); if (r) onConfirm(r, symbol); }} className="flex h-9 items-center gap-1 rounded-lg bg-[#FF7A18] px-3 text-xs font-black text-[#181205] disabled:opacity-50"><CheckCircle2 size={14}/> Confirm Result</button>
      </div>
    </div>
  );
}