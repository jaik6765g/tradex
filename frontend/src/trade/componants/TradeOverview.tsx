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
    gradient: 'from-[#FF7A18] to-[#FF8F3D]',
    glow: 'shadow-[0_0_12px_rgba(255,122,24,0.3)]',
  },
  {
    label: 'Locked',
    value: '0.00',
    unit: 'TDX',
    icon: LockKeyhole,
    gradient: 'from-[#C99752] to-[#C99752]',
    glow: 'shadow-[0_0_12px_rgba(255,122,24,0.3)]',
  },
  {
    label: 'Positions',
    value: '0',
    unit: 'Open',
    icon: TrendingUp,
    gradient: 'from-[#34D399] to-[#059669]',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.3)]',
  },
  {
    label: 'P&L',
    value: '+0.00',
    unit: 'TDX',
    icon: PieChart,
    gradient: 'from-[#C99752] to-[#C99752]',
    glow: 'shadow-[0_0_12px_rgba(201,151,82,0.3)]',
    profit: true,
  },
];

export default function TradeOverview() {
  return (
      <div className="relative bg-[#15161C] rounded-[20px] border border-[#202229] px-4 py-3.5 shadow-[0_4px_20px_rgba(16,24,40,0.06)] overflow-hidden">
        {/* Subtle top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#FF7A18] via-[#C99752] to-[#C99752]" />

        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#FF7A18]" />
            <h2 className="text-[#F5F5F7] text-[15px] font-black tracking-tight">
              TradeX Overview
            </h2>
          </div>

          <button className="text-[#FF7A18] text-xs font-bold hover:text-[#FF8F3D] transition-colors">
            View All ›
          </button>
        </div>

        <div className="flex items-stretch gap-1">
          {stats.map((stat, index) => {
            const Icon = stat.icon;

            return (
                <React.Fragment key={stat.label}>
                  {index > 0 && (
                      <div className="w-px bg-gradient-to-b from-transparent via-[#202229] to-transparent mx-0.5" />
                  )}

                  <div className="flex-1 min-w-0 flex flex-col items-center group cursor-pointer">
                    <div
                        className={`w-7 h-7 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-1.5 ${stat.glow} transition-transform duration-300 group-hover:scale-110`}
                    >
                      <Icon size={14} className="text-white" strokeWidth={2.5} />
                    </div>

                    <div className="text-[#A1A4AE] text-[10px] font-medium text-center mb-0.5">
                      {stat.label}
                    </div>

                    <div
                        className={`text-[14px] font-black leading-tight ${
                            stat.profit
                                ? 'text-[#4ADE80]'
                                : 'text-[#F5F5F7]'
                        }`}
                    >
                      {stat.value}
                    </div>

                    <div className="text-[#70737E] text-[8.5px] mt-px">
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