import React from 'react';
import { Activity } from 'lucide-react';
import { formatDateTime } from './adminLottoUtils';
import type { AdminLottoResultItem } from '../services/adminLotto.service';

export default function RecentResultsCard({ results }: { results: AdminLottoResultItem[] }) {
  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center gap-2"><Activity size={16} className="text-[#754708]"/><h3 className="text-sm font-black text-[#111827]">Recent Results</h3></div>
      <div className="mt-3 space-y-2">
        {results.length === 0 && <p className="text-xs text-[#667085]">No results yet</p>}
        {results.slice(0, 5).map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] p-2 text-xs">
            <div>
              <p className="font-black text-[#111827]">#{r.roundNumber ?? '—'} <span className="text-[#067647]">{r.result ?? '—'}</span></p>
              <p className="text-[10px] text-[#667085]">{r.category} · {formatDateTime(r.generatedAt)}</p>
            </div>
            <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${r.resultSource === 'ADMIN' ? 'bg-[#FFFAEB] text-[#B54708]' : 'bg-[#ECFDF3] text-[#067647]'}`}>{r.resultSource ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}