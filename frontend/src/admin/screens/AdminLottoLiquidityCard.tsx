import React from 'react';
import { Droplets, Plus, ShieldCheck } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoDashboard } from '../services/adminLotto.service';

export default function LiquidityCard({ dashboard, onAdd, onRemove }: { dashboard: AdminLottoDashboard | null; onAdd: () => void; onRemove: () => void }) {
  const pool = dashboard?.game?.poolBalance ?? 0;
  const reserved = dashboard?.game?.reservedLiquidity ?? 0;
  const available = dashboard?.game?.availableLiquidity ?? 0;
  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Droplets size={16} className="text-[#3538CD]"/><h3 className="text-sm font-black text-[#111827]">Liquidity / Exposure</h3></div>
        <div className="flex gap-1">
          <button type="button" onClick={onAdd} className="flex h-7 items-center gap-1 rounded-lg border border-[#E4E7EC] px-2 text-[10px] font-bold text-[#475467] hover:bg-[#F9FAFB]"><Plus size={10}/> Add</button>
          <button type="button" onClick={onRemove} className="flex h-7 items-center gap-1 rounded-lg border border-[#E4E7EC] px-2 text-[10px] font-bold text-[#475467] hover:bg-[#F9FAFB]"><ShieldCheck size={10}/> Remove</button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
        <div className="rounded-lg bg-[#F8FAFC] p-2 flex justify-between"><p className="text-[#667085]">Pool balance</p><p className="font-black text-[#111827]">{formatTdx(pool)} TDX</p></div>
        <div className="rounded-lg bg-[#F8FAFC] p-2 flex justify-between"><p className="text-[#667085]">Reserved liability</p><p className="font-black text-[#B42318]">{formatTdx(reserved)} TDX</p></div>
        <div className="rounded-lg bg-[#F8FAFC] p-2 flex justify-between"><p className="text-[#667085]">Available</p><p className="font-black text-[#067647]">{formatTdx(available)} TDX</p></div>
      </div>
    </div>
  );
}