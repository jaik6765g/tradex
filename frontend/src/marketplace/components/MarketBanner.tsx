import React, { useState } from 'react';
import {
  ChevronRight,
  Coins,
  Gamepad2,
} from 'lucide-react';

const banners = [
  {
    title: 'Trade. Earn. Win.',
    highlight: 'All in one Marketplace',
    desc: 'Buy, sell and explore exclusive digital assets.',
  },
  {
    title: 'Discover. Trade. Enjoy.',
    highlight: 'Everything in one place',
    desc: 'Explore games, NFTs, tokens and rewards.',
  },
  {
    title: 'Your Digital World.',
    highlight: 'Powered by TradeX',
    desc: 'Use TDX across the TradeX ecosystem.',
  },
];

export default function MarketBanner() {
  const [active, setActive] = useState(0);

  const next = () => {
    setActive((active + 1) % banners.length);
  };

  const banner = banners[active];

  return (
    <div className="mx-5 mb-3 rounded-2xl overflow-hidden bg-[#111217]">
      <div className="flex p-5 items-center justify-between min-h-[185px]">
        <div className="flex-1">
          <div className="text-white text-xl font-bold">
            {banner.title}
          </div>

          <div className="text-[#FF7A18] text-xl font-bold">
            {banner.highlight}
          </div>

          <div className="text-[#70737E] text-xs mt-1 max-w-[340px]">
            {banner.desc}
          </div>

          <button
            onClick={next}
            className="mt-3 bg-[#FF7A18] flex items-center gap-1 px-3.5 py-2.5 rounded-full text-[#F5F5F7] text-xs font-bold hover:bg-[#FF8F3D] transition"
          >
            Explore Now
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="ml-5 relative w-[115px] h-[120px] flex items-center justify-center">
          <Coins
            size={82}
            strokeWidth={1.5}
            className="text-[#FF7A18] drop-shadow-[0_4px_12px_rgba(255,122,24,0.25)]"
          />

          <Gamepad2
            size={42}
            className="absolute bottom-0 left-0 text-white drop-shadow-lg"
          />
        </div>
      </div>

      <div className="flex justify-center gap-1 pb-3">
        {banners.map((_, index) => (
          <button
            key={index}
            onClick={() => setActive(index)}
            className={`h-1.5 rounded-full transition-all ${
              index === active
                ? 'w-4 bg-[#FF7A18]'
                : 'w-1.5 bg-[#4F525C]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
