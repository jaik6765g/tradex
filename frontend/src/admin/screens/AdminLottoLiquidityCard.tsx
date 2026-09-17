import React from 'react';
import { Droplets, Plus, ShieldCheck } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoDashboard } from '../services/adminLotto.service';

export default function LiquidityCard({ dashboard, onAdd, onRemove }: { dashboard: AdminLottoDashboard | null; onAdd: () => void; onRemove: () => void }) {
  const pool = dashboard?.game?.poolBalance ?? 0;
  const reserved = dashboard?.game?.reservedLiquidity ?? 0;
  const available = dashboard?.game?.availableLiquidity ?? 0;
  return (
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Droplets size={16} className="text-[#818CF8]"/><h3 className="text-sm font-black text-[#F5F5F7]">Liquidity / Exposure</h3></div>
        <div className="flex gap-1">
          <button type="button" onClick={onAdd} className="flex h-7 items-center gap-1 rounded-lg border border-[#292B33] px-2 text-[10px] font-bold text-[#A1A4AE] hover:bg-[#15161C]"><Plus size={10}/> Add</button>
          <button type="button" onClick={onRemove} className="flex h-7 items-center gap-1 rounded-lg border border-[#292B33] px-2 text-[10px] font-bold text-[#A1A4AE] hover:bg-[#15161C]"><ShieldCheck size={10}/> Remove</button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <div className="rounded-lg bg-[#111217] p-2 flex justify-between"><p className="text-[#A1A4AE]">Pool balance</p><p className="font-black text-[#F5F5F7]">{formatTdx(pool)} TDX</p></div>
        <div className="rounded-lg bg-[#111217] p-2 flex justify-between"><p className="text-[#A1A4AE]">Reserved liability</p><p className="font-black text-[#F87171]">{formatTdx(reserved)} TDX</p></div>
        <div className="rounded-lg bg-[#111217] p-2 flex justify-between"><p className="text-[#A1A4AE]">Available</p><p className="font-black text-[#4ADE80]">{formatTdx(available)} TDX</p></div>
      </div>
    </div>
  );
}