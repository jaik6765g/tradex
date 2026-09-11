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
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-[#067647]"/><h3 className="text-sm font-black text-[#111827]">Settlement</h3></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Pending rounds</p><p className="font-black text-[#111827]">{pendingRounds}</p></div>
        <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Pending tickets</p><p className="font-black text-[#111827]">{pendingTickets}</p></div>
        <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Lifetime tickets</p><p className="font-black text-[#111827]">{totalTickets}</p></div>
        <div className="rounded-lg bg-[#F8FAFC] p-2"><p className="text-[#667085]">Lifetime volume</p><p className="font-black text-[#111827]">{formatTdx(totalVolume)} TDX</p></div>
      </div>
    </div>
  );
}