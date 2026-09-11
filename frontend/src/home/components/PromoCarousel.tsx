import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const banners = [
  {
    title: 'TradeX Token (TDX)',
    headline: 'Powering Every Trade & Win!',
    description: 'Use TDX in Games, Trade, Rewards & More.',
    button: 'Explore Now',
  },
  {
    title: 'One Balance. Every Experience.',
    headline: 'Use TDX Everywhere.',
    description: 'Play, trade and participate across TradeX.',
    button: 'Get Started',
  },
  {
    title: 'TradeX Marketplace',
    headline: 'Discover More With TDX.',
    description: 'Access games, markets and rewards from one balance.',
    button: 'View Market',
  },
];

export default function PromoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % banners.length);
    }, 4000);

    return () => window.clearInterval(timer);
  }, []);

  const banner = banners[activeIndex];

  const previous = () => {
    setActiveIndex(
      activeIndex === 0
        ? banners.length - 1
        : activeIndex - 1
    );
  };

  const next = () => {
    setActiveIndex((activeIndex + 1) % banners.length);
  };

  return (
    <div>
      <div className="relative h-[190px] rounded-[22px] bg-[#07111F] overflow-hidden flex">
        <div className="flex-1 px-[22px] pt-[18px] pb-4 z-10">
          <div className="text-[#F5B800] text-sm font-bold">
            {banner.title}
          </div>

          <div className="text-white text-[18px] font-black leading-[25px] mt-1.5">
            {banner.headline}
          </div>

          <div className="text-[#D0D5DD] text-sm leading-5 mt-1.5 max-w-[205px]">
            {banner.description}
          </div>

          <button className="mt-3 px-[15px] py-[9px] rounded-[14px] bg-[#F5B800] flex items-center gap-2 text-[#111827] text-sm font-black hover:bg-[#FFD85C] transition">
            {banner.button}
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="w-[145px] relative hidden sm:block">
          <div className="absolute top-[42px] left-[2px] w-[90px] h-[90px] rounded-full bg-[#F5B800] border-[5px] border-[#FFD85C] flex items-center justify-center rotate-[-12deg] shadow-[0_0_30px_rgba(245,184,0,0.5)]">
            <span className="text-[#7A5200] text-[18px] font-black">
              TDX
            </span>
          </div>

          <div className="absolute w-[34px] h-[34px] rounded-full bg-[#F5B800] top-[25px] left-0 flex items-center justify-center">
            <span className="text-[7px] font-black text-[#7A5200]">
              TDX
            </span>
          </div>

          <div className="absolute w-[90px] h-[160px] right-[-15px] top-[15px] border-[5px] border-[#344054] rounded-[18px] bg-[#101828] p-3">
            <div className="text-[#F5B800] font-extrabold text-[10px]">
              TradeX
            </div>

            <div className="text-white text-xs font-extrabold mt-[24px]">
              0.00 TDX
            </div>

            <div className="flex gap-1.5 mt-3">
              <div className="w-8 h-8 rounded-lg bg-[#1D2939] flex items-center justify-center text-white">
                +
              </div>
              <div className="w-8 h-8 rounded-lg bg-[#1D2939] flex items-center justify-center text-white">
                ↕
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={previous}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center z-20 hover:bg-white/25"
        >
          <ChevronLeft size={22} color="white" />
        </button>

        <button
          onClick={next}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center z-20 hover:bg-white/25"
        >
          <ChevronRight size={22} color="white" />
        </button>
      </div>

      <div className="h-7 flex items-center justify-center gap-2">
        {banners.map((_, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`rounded-full transition-all ${
              index === activeIndex
                ? 'w-[11px] h-[11px] bg-[#111827]'
                : 'w-2 h-2 bg-[#D0D5DD]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
