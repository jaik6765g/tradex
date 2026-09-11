import React from 'react';
import {
  ChevronRight,
  Gift,
  Trophy,
} from 'lucide-react';

export default function PromoCard() {
  return (
    <div className="flex gap-3 mx-5 mt-1 mb-[90px]">
      <button className="flex-1 p-4 rounded-2xl bg-[#FEF3C7] flex items-start gap-2 hover:shadow-sm transition text-left">
        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
          <Trophy size={17} color="#D97706" />
        </div>

        <div className="flex-1">
          <div className="text-[13px] font-bold text-[#111827]">
            Weekly Top Collection
          </div>

          <div className="text-[10px] text-[#6B7280] mt-0.5 leading-[14px]">
            Check out this week's most popular collection
          </div>
        </div>

        <ChevronRight
          size={16}
          color="#D97706"
          className="shrink-0"
        />
      </button>

      <button className="flex-1 p-4 rounded-2xl bg-[#EFF6FF] flex items-start gap-2 hover:shadow-sm transition text-left">
        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0">
          <Gift size={20} color="#2563EB" />
        </div>

        <div className="flex-1">
          <div className="text-[13px] font-bold text-[#111827]">
            Exclusive Offers
          </div>

          <div className="text-[10px] text-[#6B7280] mt-0.5 leading-[14px]">
            Grab limited-time deals and special rewards
          </div>
        </div>

        <ChevronRight
          size={16}
          color="#2563EB"
          className="shrink-0"
        />
      </button>
    </div>
  );
}
