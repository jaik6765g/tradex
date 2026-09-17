import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Gamepad2,
  Bot,
  TrendingUp,
  Trophy,
  XCircle,
  Activity,
} from 'lucide-react';

import { PulseTradeService } from '../../trade/pulse/services/pulseTrade.service';

type ActivityCategory = 'pulse' | 'game' | 'bot';

interface PulseActivityData {
  openPositions: number;
  totalTrades: number;
  winRate: string;
  wins: number;
  losses: number;
}

export default function ProfileActivity() {
  const [expanded, setExpanded] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<ActivityCategory | null>(null);

  const [pulseData, setPulseData] =
    useState<PulseActivityData | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || activeCategory !== 'pulse') return;

    let cancelled = false;

    const loadPulseActivity = async () => {
      try {
        setLoading(true);

        const [portfolio, openTrades] = await Promise.all([
          PulseTradeService.getPortfolio(),
          PulseTradeService.getOpenTrades(),
        ]);

        if (cancelled) return;

        setPulseData({
          openPositions: openTrades.trades?.length ?? 0,
          totalTrades: portfolio.totalTrades ?? 0,
          winRate: portfolio.winRate ?? '0',
          wins: portfolio.wins ?? 0,
          losses: portfolio.losses ?? 0,
        });
      } catch (error) {
        console.error(
          'Failed to load Pulse Trade activity:',
          error,
        );

        if (!cancelled) {
          setPulseData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPulseActivity();

    return () => {
      cancelled = true;
    };
  }, [expanded, activeCategory]);

  const toggleActivity = () => {
    setExpanded((current) => {
      const next = !current;

      if (!next) {
        setActiveCategory(null);
      }

      return next;
    });
  };

  const selectCategory = (category: ActivityCategory) => {
    setActiveCategory((current) =>
      current === category ? null : category,
    );
  };

  return (
    <div className="w-full rounded-2xl bg-[#15161C] border border-[#292B33] shadow-sm overflow-hidden">
      {/* HEADER */}
      <button
        type="button"
        onClick={toggleActivity}
        className="w-full p-3 flex items-center justify-between text-left hover:bg-[#1B1917] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#202229] flex items-center justify-center">
            <Activity size={14} className="text-[#A1A4AE]" />
          </div>

          <div>
            <h2 className="text-sm font-bold text-[#F5F5F7]">
              Your Activity
            </h2>

            <p className="text-[10px] text-[#A1A4AE]">
              Trading, games & bot activity
            </p>
          </div>
        </div>

        {expanded ? (
          <ChevronDown size={17} className="text-[#A1A4AE]" />
        ) : (
          <ChevronRight size={17} className="text-[#A1A4AE]" />
        )}
      </button>

      {/* CATEGORY LIST */}
      {expanded && (
        <div className="border-t border-[#292B33]">
          {/* PULSE TRADE */}
          <button
            type="button"
            onClick={() => selectCategory('pulse')}
            className="w-full px-3 py-3 flex items-center justify-between hover:bg-[#1B1917] transition-colors border-b border-[#292B33]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#10251A] flex items-center justify-center">
                <TrendingUp
                  size={15}
                  className="text-[#4ADE80]"
                />
              </div>

              <div className="text-left">
                <div className="text-xs font-semibold text-[#F5F5F7]">
                  Pulse Trade
                </div>

                <div className="text-[10px] text-[#A1A4AE]">
                  Trading activity
                </div>
              </div>
            </div>

            {activeCategory === 'pulse' ? (
              <ChevronDown size={16} className="text-[#70737E]" />
            ) : (
              <ChevronRight size={16} className="text-[#70737E]" />
            )}
          </button>

          {/* PULSE DATA */}
          {activeCategory === 'pulse' && (
            <div className="px-3 py-3 bg-[#1B1917] border-b border-[#292B33]">
              {loading ? (
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((item) => (
                    <div
                      key={item}
                      className="h-16 rounded-xl bg-[#15161C] border border-[#292B33] animate-pulse"
                    />
                  ))}
                </div>
              ) : pulseData ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    title="Open Positions"
                    value={pulseData.openPositions}
                    icon={TrendingUp}
                    iconClass="text-[#4ADE80]"
                    bgClass="bg-[#10251A]"
                  />

                  <Stat
                    title="Total Trades"
                    value={pulseData.totalTrades}
                    icon={Activity}
                    iconClass="text-[#C99752]"
                    bgClass="bg-[#211810]"
                  />

                  <Stat
                    title="Win Rate"
                    value={`${pulseData.winRate}%`}
                    icon={CircleDot}
                    iconClass="text-[#FF8F3D]"
                    bgClass="bg-[#2A190D]"
                  />

                  <Stat
                    title="Wins"
                    value={pulseData.wins}
                    icon={Trophy}
                    iconClass="text-[#C99752]"
                    bgClass="bg-[#211810]"
                  />

                  <Stat
                    title="Losses"
                    value={pulseData.losses}
                    icon={XCircle}
                    iconClass="text-[#F87171]"
                    bgClass="bg-[#281313]"
                  />
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-[#A1A4AE]">
                  Unable to load Pulse Trade activity.
                </div>
              )}
            </div>
          )}

          {/* GAME */}
          <button
            type="button"
            onClick={() => selectCategory('game')}
            className="w-full px-3 py-3 flex items-center justify-between hover:bg-[#1B1917] transition-colors border-b border-[#292B33]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#211810] flex items-center justify-center">
                <Gamepad2
                  size={15}
                  className="text-[#C99752]"
                />
              </div>

              <div className="text-left">
                <div className="text-xs font-semibold text-[#F5F5F7]">
                  Game
                </div>

                <div className="text-[10px] text-[#A1A4AE]">
                  Game activity
                </div>
              </div>
            </div>

            {activeCategory === 'game' ? (
              <ChevronDown size={16} className="text-[#70737E]" />
            ) : (
              <ChevronRight size={16} className="text-[#70737E]" />
            )}
          </button>

          {activeCategory === 'game' && (
            <div className="px-3 py-4 bg-[#1B1917] border-b border-[#292B33]">
              <div className="rounded-xl bg-[#15161C] border border-[#292B33] p-4 text-center">
                <Gamepad2
                  size={20}
                  className="mx-auto mb-2 text-[#70737E]"
                />

                <div className="text-xs font-semibold text-[#A1A4AE]">
                  Game Activity
                </div>

                <div className="text-[10px] text-[#A1A4AE] mt-1">
                  In development
                </div>
              </div>
            </div>
          )}

          {/* BOT TRADE */}
          <button
            type="button"
            onClick={() => selectCategory('bot')}
            className="w-full px-3 py-3 flex items-center justify-between hover:bg-[#1B1917] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#211810] flex items-center justify-center">
                <Bot
                  size={15}
                  className="text-[#C99752]"
                />
              </div>

              <div className="text-left">
                <div className="text-xs font-semibold text-[#F5F5F7]">
                  Bot Trade
                </div>

                <div className="text-[10px] text-[#A1A4AE]">
                  Automated trading activity
                </div>
              </div>
            </div>

            {activeCategory === 'bot' ? (
              <ChevronDown size={16} className="text-[#70737E]" />
            ) : (
              <ChevronRight size={16} className="text-[#70737E]" />
            )}
          </button>

          {activeCategory === 'bot' && (
            <div className="px-3 py-4 bg-[#1B1917]">
              <div className="rounded-xl bg-[#15161C] border border-[#292B33] p-4 text-center">
                <Bot
                  size={20}
                  className="mx-auto mb-2 text-[#70737E]"
                />

                <div className="text-xs font-semibold text-[#A1A4AE]">
                  Bot Trading
                </div>

                <div className="text-[10px] text-[#A1A4AE] mt-1">
                  In development
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  title,
  value,
  icon: Icon,
  iconClass,
  bgClass,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  iconClass: string;
  bgClass: string;
}) {
  return (
    <div className="rounded-xl bg-[#15161C] border border-[#292B33] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center ${bgClass}`}
        >
          <Icon size={13} className={iconClass} />
        </div>

        <div className="min-w-0">
          <div className="text-[9px] font-medium text-[#A1A4AE] truncate">
            {title}
          </div>

          <div className="text-sm font-bold text-[#F5F5F7]">
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}