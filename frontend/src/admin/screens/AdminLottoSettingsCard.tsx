import React from 'react';
import { Settings, Lock, TrendingUp } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoSettings } from '../services/adminLotto.service';

// Plain-language description of what each strategy does to the draw.
const WIN_STRATEGY_HELP: Record<string, string> = {
  RANDOM: 'Uniform random draw — no steering (default).',
  HIGH: 'The number with the HIGHEST win potential wins (most players win).',
  MEDIUM: 'The number nearest the middle of the min/max win-potential range wins.',
  LOW: 'The number with the LOWEST win potential wins (fewest players win).',
};

export default function SettingsCard({
  settings,
  onSetResultMode,
  onSetWinStrategy,
  busy,
}: {
  settings: AdminLottoSettings | null;
  onSetResultMode: (mode: string) => void;
  onSetWinStrategy: (strategy: string) => void;
  busy: boolean;
}) {
  if (!settings) return null;
  const activeStrategy = settings.game.winStrategy ?? 'RANDOM';
  return (
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center gap-2"><Settings size={16} className="text-[#A1A4AE]"/><h3 className="text-sm font-black text-[#F5F5F7]">Lotto Settings</h3></div>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[10px] font-bold text-[#A1A4AE]">Result Mode</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {settings.resultModes.map((mode) => (
              <button key={mode} type="button" disabled={busy} onClick={() => onSetResultMode(mode)} className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${settings.game.resultMode === mode ? 'border-[#FF7A18] bg-[#2A190D] text-[#FF8F3D]' : 'border-[#292B33] text-[#A1A4AE] hover:bg-[#15161C]'}`}>{mode.replace(/_/g, ' ')}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[10px] font-bold text-[#A1A4AE]"><TrendingUp size={11}/> Win Strategy <span className="font-normal text-[#70737E]">(applies to server draws; VERIFIED RANDOM is never steered)</span></p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(settings.winStrategies ?? ['RANDOM', 'HIGH', 'MEDIUM', 'LOW']).map((strategy) => (
              <button key={strategy} type="button" disabled={busy} onClick={() => onSetWinStrategy(strategy)} className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${activeStrategy === strategy ? 'border-[#FF7A18] bg-[#2A190D] text-[#FF8F3D]' : 'border-[#292B33] text-[#A1A4AE] hover:bg-[#15161C]'}`}>{strategy}</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[#A1A4AE]">{WIN_STRATEGY_HELP[activeStrategy] ?? activeStrategy}</p>
          <p className="mt-0.5 text-[10px] text-[#70737E]">Win potential = total payout owed if that number wins (net stake × multiplier of every unsettled bet on it).</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#A1A4AE]">Game Rules <span className="text-[#F87171]">(LOCKED — frozen)</span></p>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            {settings.rules.map((rule) => (
              <div key={rule.key} className="flex items-center justify-between rounded-lg bg-[#111217] p-2">
                <span className="text-[#A1A4AE]">{rule.key}</span>
                <span className="flex items-center gap-1 font-black text-[#F5F5F7]">{typeof rule.value === 'number' && rule.key.includes('Amount') ? `${formatTdx(rule.value)} TDX` : rule.breakdown ? `${rule.value}%` : rule.value}<Lock size={10} className="text-[#70737E]"/></span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold text-[#A1A4AE]">Categories</p>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            {settings.categories.map((c) => (
              <div key={c.category} className="flex items-center justify-between rounded-lg bg-[#111217] p-2">
                <span className="text-[#A1A4AE]">{c.category}</span>
                <span className="flex items-center gap-1 font-black text-[#F5F5F7]">{c.durationSeconds}s<Lock size={10} className="text-[#70737E]"/></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}