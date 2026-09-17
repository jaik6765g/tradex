import React from 'react';
import {
  ChevronRight,
  Gift,
  Trophy,
} from 'lucide-react';

export default function PromoCard() {
  return (
    <div className="flex gap-3 mx-5 mt-1 mb-[90px]">
      <button className="flex-1 p-4 rounded-2xl bg-[#2A190D] flex items-start gap-2 hover:shadow-sm transition text-left">
        <div className="w-8 h-8 rounded-full bg-[#15161C] flex items-center justify-center shrink-0">
          <Trophy size={17} color="#FF7A18" />
        </div>

        <div className="flex-1">
          <div className="text-[13px] font-bold text-[#F5F5F7]">
            Weekly Top Collection
          </div>

          <div className="text-[10px] text-[#70737E] mt-0.5 leading-[14px]">
            Check out this week's most popular collection
          </div>
        </div>

        <ChevronRight
          size={16}
          color="#FF7A18"
          className="shrink-0"
        />
      </button>

      <button className="flex-1 p-4 rounded-2xl bg-[#211810] flex items-start gap-2 hover:shadow-sm transition text-left">
        <div className="w-8 h-8 rounded-full bg-[#15161C] flex items-center justify-center shrink-0">
          <Gift size={20} color="#C99752" />
        </div>

        <div className="flex-1">
          <div className="text-[13px] font-bold text-[#F5F5F7]">
            Exclusive Offers
          </div>

          <div className="text-[10px] text-[#70737E] mt-0.5 leading-[14px]">
            Grab limited-time deals and special rewards
          </div>
        </div>

        <ChevronRight
          size={16}
          color="#C99752"
          className="shrink-0"
        />
      </button>
    </div>
  );
}
