// src/marketplace/components/AssetListItem.tsx
import React from 'react';

type Props = {
  icon: string;
  name: string;
  subtitle: string;
  price: number;
  usdPrice: number;
  change: number;
  type?: string;
  isGame?: boolean;
  comingSoon?: boolean;
  onPlayGame?: () => void;
};

export default function AssetListItem({
  icon,
  name,
  subtitle,
  price,
  usdPrice,
  change,
  isGame = false,
  comingSoon = false,
  onPlayGame,
}: Props) {
  // ✅ Coming-soon game — locked, greyed out, with "Coming Soon" badge
  if (isGame && comingSoon) {
    return (
      <div className="relative flex items-center py-3 border-b border-[#F3F4F6] last:border-b-0 rounded-lg opacity-70 cursor-not-allowed group">
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-slate-100/50 to-transparent pointer-events-none" />
        <div className="w-10 h-10 bg-gradient-to-br from-slate-300 to-slate-400 rounded-lg flex items-center justify-center mr-3 shrink-0 text-2xl grayscale-[30%]">
          {icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#9CA3AF] truncate">
            {name}
          </div>
          <div className="text-xs text-[#9CA3AF] mt-0.5">
            {subtitle}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2.5 py-0.5 text-[9px] font-black text-white shadow-sm uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            Coming Soon
          </span>
        </div>
      </div>
    );
  }

  // ✅ Active game — playable
  if (isGame) {
    return (
      <div className="flex items-center py-3 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F8FAFC] rounded-lg transition-all cursor-pointer group">
        <div className="w-10 h-10 bg-gradient-to-br from-[#f7971e] to-[#ffd200] rounded-lg flex items-center justify-center mr-3 shrink-0 text-2xl">
          {icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#111827] truncate group-hover:text-[#f7971e] transition-colors">
            {name}
          </div>
          <div className="text-xs text-[#6B7280] mt-0.5">
            {subtitle}
          </div>
        </div>

        <div className="w-24 text-right shrink-0">
          <div className="text-sm font-bold text-[#16A34A]">
            🎮 Play Now
          </div>
          <div className="text-xs text-[#6B7280]">
            Win up to 100x
          </div>
        </div>

        <button
          onClick={onPlayGame}
          className="ml-2 px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-[#f7971e] to-[#ffd200] text-[#1a1a2e] hover:shadow-lg hover:shadow-[#f7971e]/30 transition-all transform hover:scale-105"
        >
          Play →
        </button>
      </div>
    );
  }

  // ✅ Regular asset item
  const isPositive = change >= 0;

  return (
    <div className="flex items-center py-3 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F8FAFC] rounded-lg transition-all">
      <div className="w-10 h-10 bg-[#F1F5F9] rounded-lg flex items-center justify-center mr-3 shrink-0 text-xl">
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-[#111827] truncate">
          {name}
        </div>
        <div className="text-xs text-[#6B7280] mt-0.5">
          {subtitle}
        </div>
      </div>

      <div className="w-24 text-right shrink-0">
        <div className="text-sm font-bold text-[#111827]">
          {price.toFixed(2)} TDX
        </div>
        <div className="text-xs text-[#6B7280]">
          ≈ ${usdPrice.toFixed(2)}
        </div>
      </div>

      <div
        className={`px-2 py-1 rounded-lg ml-2 text-xs font-bold shrink-0 ${
          isPositive
            ? 'bg-[#DCFCE7] text-[#16A34A]'
            : 'bg-[#FEE2E2] text-[#DC2626]'
        }`}
      >
        {isPositive ? '+' : ''}
        {change.toFixed(2)}%
      </div>
    </div>
  );
}