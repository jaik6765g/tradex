import React from 'react';
import { Settings, Lock } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoSettings } from '../services/adminLotto.service';

export default function SettingsCard({ settings, onSetResultMode, busy }: { settings: AdminLottoSettings | null; onSetResultMode: (mode: string) => void; busy: boolean }) {
  if (!settings) return null;
  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center gap-2"><Settings size={16} className="text-[#475467]"/><h3 className="text-sm font-black text-[#111827]">Lotto Settings</h3></div>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[10px] font-bold text-[#667085]">Result Mode</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {settings.resultModes.map((mode) => (
              <button key={mode} type="button" disabled={busy} onClick={() => onSetResultMode(mode)} className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${settings.game.resultMode === mode ? 'border-[#F5B800] bg-[#FFFAEB] text-[#B54708]' : 'border-[#E4E7EC] text-[#475467] hover:bg-[#F9FAFB]'}`}>{mode.replace(/_/g, ' ')}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#667085]">Game Rules <span className="text-[#B42318]">(LOCKED — frozen)</span></p>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            {settings.rules.map((rule) => (
              <div key={rule.key} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] p-2">
                <span className="text-[#667085]">{rule.key}</span>
                <span className="flex items-center gap-1 font-black text-[#111827]">{typeof rule.value === 'number' && rule.key.includes('Amount') ? `${formatTdx(rule.value)} TDX` : rule.breakdown ? `${rule.value}%` : rule.value}<Lock size={10} className="text-[#98A2B3]"/></span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#667085]">Categories</p>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            {settings.categories.map((c) => (
              <div key={c.category} className="flex items-center justify-between rounded-lg bg-[#F8FAFC] p-2">
                <span className="text-[#667085]">{c.category}</span>
                <span className="flex items-center gap-1 font-black text-[#111827]">{c.durationSeconds}s<Lock size={10} className="text-[#98A2B3]"/></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}