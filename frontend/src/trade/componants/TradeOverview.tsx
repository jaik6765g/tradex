import React from 'react';
import {
  LockKeyhole,
  PieChart,
  TrendingUp,
  Wallet,
  Sparkles,
} from 'lucide-react';

const stats = [
  {
    label: 'Available',
    value: '0.00',
    unit: 'TDX',
    icon: Wallet,
    gradient: 'from-[#FBBF24] to-[#F59E0B]',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.3)]',
  },
  {
    label: 'Locked',
    value: '0.00',
    unit: 'TDX',
    icon: LockKeyhole,
    gradient: 'from-[#3B82F6] to-[#2563EB]',
    glow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
  },
  {
    label: 'Positions',
    value: '0',
    unit: 'Open',
    icon: TrendingUp,
    gradient: 'from-[#10B981] to-[#059669]',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.3)]',
  },
  {
    label: 'P&L',
    value: '+0.00',
    unit: 'TDX',
    icon: PieChart,
    gradient: 'from-[#8B5CF6] to-[#7C3AED]',
    glow: 'shadow-[0_0_12px_rgba(139,92,246,0.3)]',
    profit: true,
  },
];

export default function TradeOverview() {
  return (
      <div className="relative bg-white rounded-[20px] border border-[#E9ECF2] px-4 py-3.5 shadow-[0_4px_20px_rgba(16,24,40,0.06)] overflow-hidden">
        {/* Subtle top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#FBBF24] via-[#8B5CF6] to-[#3B82F6]" />

        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#FBBF24]" />
            <h2 className="text-[#101828] text-[15px] font-black tracking-tight">
              TradeX Overview
            </h2>
          </div>

          <button className="text-[#FBBF24] text-xs font-bold hover:text-[#F59E0B] transition-colors">
            View All ›
          </button>
        </div>

        <div className="flex items-stretch gap-1">
          {stats.map((stat, index) => {
            const Icon = stat.icon;

            return (
                <React.Fragment key={stat.label}>
                  {index > 0 && (
                      <div className="w-px bg-gradient-to-b from-transparent via-[#EAECF0] to-transparent mx-0.5" />
                  )}

                  <div className="flex-1 min-w-0 flex flex-col items-center group cursor-pointer">
                    <div
                        className={`w-7 h-7 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-1.5 ${stat.glow} transition-transform duration-300 group-hover:scale-110`}
                    >
                      <Icon size={14} className="text-white" strokeWidth={2.5} />
                    </div>

                    <div className="text-[#667085] text-[10px] font-medium text-center mb-0.5">
                      {stat.label}
                    </div>

                    <div
                        className={`text-[14px] font-black leading-tight ${
                            stat.profit
                                ? 'text-[#16A34A]'
                                : 'text-[#101828]'
                        }`}
                    >
                      {stat.value}
                    </div>

                    <div className="text-[#98A2B3] text-[8.5px] mt-px">
                      {stat.unit}
                    </div>
                  </div>
                </React.Fragment>
            );
          })}
        </div>
      </div>
  );
}