import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  Rocket,
  TrendingUp,
  ArrowLeftRight,
  Sparkles,
} from 'lucide-react';

const SLIDES = [
  {
    title: 'Trade. Earn. Win.',
    highlight: 'All in one TradeX',
    description: 'Explore multiple ways to use your TDX across TradeX with cutting-edge tools.',
    button: 'Explore Now',
    icon: TrendingUp,
  },
  {
    title: 'Power Your',
    highlight: 'Trade with TDX',
    description: 'Use TDX across Pulse, Pool, Prediction and Bot Trade with zero friction.',
    button: 'Start Trading',
    icon: ArrowLeftRight,
  },
  {
    title: 'One Token.',
    highlight: 'Four Ways to Trade.',
    description: 'Choose your trading style and manage your TDX your way with premium liquidity.',
    button: 'View Trade Types',
    icon: Rocket,
  },
];

export default function TradeHero() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % SLIDES.length);
    }, 3500);

    return () => window.clearInterval(timer);
  }, []);

  const slide = SLIDES[activeIndex];
  const Icon = slide.icon;

  return (
      <div className="relative w-full h-[210px] rounded-[22px] overflow-hidden bg-gradient-to-br from-[#211810] via-[#211810] to-[#34261C] shadow-[0_8px_40px_rgba(0,0,0,0.35)] border border-white/10">
        {/* Subtle background patterns */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-10 -left-10 w-52 h-52 rounded-full bg-[#FF7A18] blur-[100px]" />
          <div className="absolute -bottom-10 -right-10 w-52 h-52 rounded-full bg-[#C99752] blur-[100px]" />
        </div>

        <div className="h-full px-6 py-5 flex relative overflow-hidden">
          <div className="w-[61%] relative z-10">
            <div className="text-white text-[24px] font-black leading-[30px] tracking-tight drop-shadow-md">
              {slide.title}
            </div>

            <div className="text-[#FF7A18] text-[24px] font-black leading-[30px] tracking-tight drop-shadow-[0_2px_10px_rgba(255,122,24,0.3)]">
              {slide.highlight}
            </div>

            <div className="text-[#A1A4AE] text-[13px] leading-[19px] mt-2 max-w-[230px] opacity-90">
              {slide.description}
            </div>

            <button className="mt-4 bg-gradient-to-r from-[#FF7A18] to-[#FF8F3D] rounded-[12px] px-5 py-2.5 flex items-center gap-2 text-[#211810] text-[13px] font-black shadow-[0_4px_15px_rgba(255,122,24,0.4)] hover:shadow-[0_6px_25px_rgba(255,122,24,0.35)] hover:scale-[1.02] transition-all duration-300">
              {slide.button}
              <ChevronRight size={18} className="stroke-[2.5]" />
            </button>
          </div>

          <div className="absolute right-[-10px] top-0 w-[48%] h-[210px]">
            {/* Glow behind the TDX coin */}
            <div className="absolute w-[180px] h-[180px] rounded-full bg-[#FF7A18]/[0.1] right-0 top-6 blur-[20px]" />

            <div className="absolute w-[115px] h-[115px] rounded-full right-5 top-[42px] bg-gradient-to-br from-[#FF7A18] to-[#FF8F3D] flex items-center justify-center shadow-[0_0_35px_rgba(255,122,24,0.35)] animate-pulse-slow border-2 border-white/20">
            <span className="text-[#211810] text-[28px] font-black drop-shadow-sm">
              TDX
            </span>
            </div>

            <div className="absolute w-[30px] h-[30px] rounded-full right-[135px] top-[35px] bg-gradient-to-br from-[#FF8F3D] to-[#FF7A18] flex items-center justify-center shadow-[0_0_15px_rgba(255,122,24,0.3)]">
              <span className="text-white text-[12px] font-black">T</span>
            </div>

            <div className="absolute w-[34px] h-[34px] rounded-full right-1 bottom-[30px] bg-gradient-to-br from-[#FF8F3D] to-[#FF7A18] flex items-center justify-center shadow-[0_0_15px_rgba(255,122,24,0.3)]">
              <span className="text-white text-[12px] font-black">T</span>
            </div>

            <div className="absolute right-[115px] bottom-[20px] w-[60px] h-[60px] rounded-full bg-[#211810]/80 border border-white/20 backdrop-blur-sm flex items-center justify-center shadow-[0_0_20px_rgba(255,122,24,0.2)]">
              <Icon size={46} color="#FF7A18" strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Premium Dots */}
        <div className="absolute bottom-[10px] left-0 right-0 flex justify-center items-center gap-2">
          {SLIDES.map((_, index) => (
              <button
                  key={index}
                  onClick={() => setActiveIndex(index)}
                  className={`h-[8px] rounded-full transition-all duration-300 ${
                      index === activeIndex
                          ? 'w-6 bg-gradient-to-r from-[#FF7A18] to-[#FF8F3D] shadow-[0_0_10px_rgba(255,122,24,0.35)]'
                          : 'w-[8px] bg-[#70737E] hover:bg-[#A1A4AE]'
                  }`}
              />
          ))}
        </div>
      </div>
  );
}