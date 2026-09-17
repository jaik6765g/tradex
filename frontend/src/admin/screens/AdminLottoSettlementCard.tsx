import React from 'react';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { formatTdx } from './adminLottoUtils';
import type { AdminLottoDashboard } from '../services/adminLotto.service';

export default function SettlementCard({ dashboard }: { dashboard: AdminLottoDashboard | null }) {
  const pendingRounds = dashboard?.settlement?.pendingRounds ?? 0;
  const pendingTickets = dashboard?.settlement?.pendingTickets ?? 0;
  const totalTickets = dashboard?.totals?.totalTickets ?? 0;
  const totalVolume = dashboard?.totals?.totalVolume ?? 0;
  return (
    <div className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
      <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-[#4ADE80]"/><h3 className="text-sm font-black text-[#F5F5F7]">Settlement</h3></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Pending rounds</p><p className="font-black text-[#F5F5F7]">{pendingRounds}</p></div>
        <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Pending tickets</p><p className="font-black text-[#F5F5F7]">{pendingTickets}</p></div>
        <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Lifetime tickets</p><p className="font-black text-[#F5F5F7]">{totalTickets}</p></div>
        <div className="rounded-lg bg-[#111217] p-2"><p className="text-[#A1A4AE]">Lifetime volume</p><p className="font-black text-[#F5F5F7]">{formatTdx(totalVolume)} TDX</p></div>
      </div>
    </div>
  );
}