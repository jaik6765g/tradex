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
      <div className="relative h-[210px] min-[480px]:h-[190px] rounded-[22px] border border-[#292B33] bg-[#111217] overflow-hidden flex">
        <div className="flex-1 py-[18px] pl-[54px] pr-4 z-10">
          <div className="text-[#FF8F3D] text-sm font-bold">
            {banner.title}
          </div>

          <div className="text-white text-[18px] font-black leading-[25px] mt-1.5">
            {banner.headline}
          </div>

          <div className="text-[#A1A4AE] text-sm leading-5 mt-1.5 max-w-[205px]">
            {banner.description}
          </div>

          <button className="mt-3 px-[15px] py-[9px] rounded-[14px] bg-[#FF7A18] flex items-center gap-2 text-[#F5F5F7] text-sm font-black hover:bg-[#FF8F3D] transition">
            {banner.button}
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="w-[145px] relative hidden sm:block">
          <div className="absolute top-[42px] left-[2px] w-[90px] h-[90px] rounded-full bg-[#FF7A18] border-[5px] border-[#FF8F3D] flex items-center justify-center rotate-[-12deg] shadow-[0_0_20px_rgba(255,122,24,0.35)]">
            <span className="text-white text-[18px] font-black">
              TDX
            </span>
          </div>

          <div className="absolute w-[34px] h-[34px] rounded-full bg-[#FF7A18] top-[25px] left-0 flex items-center justify-center">
            <span className="text-[7px] font-black text-white">
              TDX
            </span>
          </div>

          <div className="absolute w-[90px] h-[160px] right-[-12px] top-[15px] border-[5px] border-[#292B33] rounded-[18px] bg-[#1A1A20] p-3">
            <div className="text-[#FF7A18] font-extrabold text-[10px]">
              TradeX
            </div>

            <div className="text-white text-xs font-extrabold mt-[24px]">
              0.00 TDX
            </div>

            <div className="flex gap-1.5 mt-3">
              <div className="w-8 h-8 rounded-lg bg-[#2E2E3A] flex items-center justify-center text-white">
                +
              </div>
              <div className="w-8 h-8 rounded-lg bg-[#2E2E3A] flex items-center justify-center text-white">
                ↕
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={previous}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border border-[#292B33] bg-[#1F1F28]/90 flex items-center justify-center z-20 transition hover:bg-[#292B33]"
        >
          <ChevronLeft size={20} color="white" />
        </button>

        <button
          onClick={next}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full border border-[#292B33] bg-[#1F1F28]/90 flex items-center justify-center z-20 transition hover:bg-[#292B33]"
        >
          <ChevronRight size={20} color="white" />
        </button>
      </div>

      <div className="h-7 flex items-center justify-center gap-2">
        {banners.map((_, index) => (
          <button
            key={index}
            onClick={() => setActiveIndex(index)}
            className={`rounded-full transition-all ${
              index === activeIndex
                ? 'w-[11px] h-[11px] bg-[#FF7A18]'
                : 'w-2 h-2 bg-[#3A3A46]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
