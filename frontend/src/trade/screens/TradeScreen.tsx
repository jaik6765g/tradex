// src/trade/screens/TradeScreen.tsx

import React from 'react';
import { Sparkles, Layers } from 'lucide-react';

import TradeHero from '../componants/TradeHero';
import TradeOverview from '../componants/TradeOverview';
import TradeTypesGrid from '../componants/TradeTypesGrid';

export default function TradeScreen() {
  return (
      <div className="relative min-h-screen bg-[#15161C] overflow-hidden">
        {/* Main Content */}
        <div className="relative max-w-7xl mx-auto px-4 py-6 space-y-5">
          {/* Hero Section */}
          <TradeHero />

          {/* Overview Stats */}
          <TradeOverview />

          {/* Trade Types Section (Premium White Card) */}
          <div className="relative bg-[#15161C] rounded-[24px] p-5 border border-[#202229] shadow-[0_4px_20px_rgba(16,24,40,0.04)]">
            {/* Subtle Top Glow */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#FF7A18]/40 to-transparent" />

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-[10px] bg-gradient-to-br from-[#FF7A18] to-[#FF8F3D] shadow-[0_2px_8px_rgba(255,122,24,0.3)]">
                  <Layers size={16} className="text-white" strokeWidth={2.5} />
                </div>
                <h2 className="text-[#F5F5F7] text-[17px] font-black tracking-tight">
                  Select Trade Type
                </h2>
                <Sparkles size={14} className="text-[#FF7A18] ml-1" />
              </div>
              <span className="text-[#A1A4AE] text-xs font-medium">
              Powered by TradeX
            </span>
            </div>

            <TradeTypesGrid />
          </div>
        </div>
      </div>
  );
}