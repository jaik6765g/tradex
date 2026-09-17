import React from 'react';
import { Activity } from 'lucide-react';
import { formatDateTime } from './adminLottoUtils';
import type { AdminLottoResultItem } from '../services/adminLotto.service';

export default function RecentResultsCard({ results }: { results: AdminLottoResultItem[] }) {
  return (
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center gap-2"><Activity size={16} className="text-[#754708]"/><h3 className="text-sm font-black text-[#F5F5F7]">Recent Results</h3></div>
      <div className="mt-3 space-y-2">
        {results.length === 0 && <p className="text-xs text-[#A1A4AE]">No results yet</p>}
        {results.slice(0, 5).map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg bg-[#111217] p-2 text-xs">
            <div>
              <p className="font-black text-[#F5F5F7]">#{r.roundNumber ?? '—'} <span className="text-[#4ADE80]">{r.result ?? '—'}</span></p>
              <p className="text-[10px] text-[#A1A4AE]">{r.category} · {formatDateTime(r.generatedAt)}</p>
            </div>
            <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${r.resultSource === 'ADMIN' ? 'bg-[#2A190D] text-[#FF8F3D]' : 'bg-[#10251A] text-[#4ADE80]'}`}>{r.resultSource ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}