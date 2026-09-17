// frontend/src/components/TradeTypeCard.tsx

import React from 'react';
import { ChevronRight, Sparkles, Clock } from 'lucide-react';

type Props = {
  title: string;
  tag: string;
  description: string;
  image: string;
  tagColor: string;
  tagBackground: string;
  onPress: () => void;
  isComingSoon?: boolean;
};

export default function TradeTypeCard({
  title,
  tag,
  description,
  image,
  tagColor,
  tagBackground,
  onPress,
  isComingSoon = false,
}: Props) {
  return (
    <button
      onClick={onPress}
      disabled={isComingSoon}
      className={`
        group relative w-[160px] h-[200px] shrink-0 bg-[#15161C] rounded-[22px] 
        border border-[#202229] overflow-hidden text-left 
        shadow-[0_4px_20px_rgba(16,24,40,0.06)] 
        transition-all duration-300
        ${isComingSoon 
          ? 'cursor-not-allowed' 
          : 'hover:shadow-[0_8px_40px_rgba(16,24,40,0.12)] hover:scale-[1.02] hover:border-[#FF7A18]'
        }
      `}
    >
      {/* Background Image */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-contain opacity-100 group-hover:scale-110 transition-transform duration-300"
        />
        <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-[#202229] via-[#15161C]/80 to-transparent" />
      </div>

      {/* ✅ Coming Soon Overlay - Piche ka text dikhega */}
      {isComingSoon && (
        <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center z-10">
          <div className="bg-[#FF7A18]/80 backdrop-blur-sm px-5 py-2.5 rounded-full flex items-center gap-2 shadow-lg border border-white/10">
            <Clock size={16} className="text-[#FF7A18]" />
            <span className="text-white text-[11px] font-black uppercase tracking-wider">
              Coming Soon
            </span>
          </div>
        </div>
      )}

      {/* Content Overlay */}
      <div className="relative h-full flex flex-col justify-end p-[12px]">
        {/* Premium Tag */}
        <span
          className="inline-flex items-center gap-1 px-[8px] py-[3px] rounded-[8px] mb-[6px] text-[9.5px] font-black uppercase tracking-[0.5px] shadow-sm w-fit"
          style={{
            color: tagColor,
            backgroundColor: tagBackground,
          }}
        >
          <Sparkles size={10} />
          {tag}
        </span>

        <div className="text-[#F5F5F7] text-[15px] font-black tracking-tight mb-[3px] group-hover:text-[#FF8F3D] transition-colors">
          {title}
        </div>

        <div className="text-[#A1A4AE] text-[11px] leading-[15px] pr-5 line-clamp-2">
          {description}
        </div>
      </div>

      {/* Premium Arrow (Bottom Right) */}
      <div className={`
        absolute right-[10px] bottom-[10px] w-[30px] h-[30px] rounded-full 
        border border-[#292B33] bg-[#15161C]/80 backdrop-blur-sm 
        flex items-center justify-center 
        transition-all duration-300
        ${isComingSoon 
          ? 'opacity-40' 
          : 'group-hover:bg-gradient-to-br group-hover:from-[#FF7A18] group-hover:to-[#FF8F3D] group-hover:border-transparent group-hover:scale-110'
        }
      `}>
        <ChevronRight size={16} className={`
          text-[#211810] 
          ${isComingSoon ? 'opacity-40' : 'group-hover:text-white'}
          transition-colors duration-300
        `} strokeWidth={2.5} />
      </div>
    </button>
  );
}