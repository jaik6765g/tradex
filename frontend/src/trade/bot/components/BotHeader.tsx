import React from 'react';
import { Bot, Zap, TrendingUp, Calendar, Shield } from 'lucide-react';

import Badge from '../../../components/ui/Badge';
import type { BotAccountStatus } from '../types/bot.types';

type Props = {
  status: BotAccountStatus;
  accountId?: string;
  totalProfit?: string;
  activeSince?: string;
  todayProfit?: string;
};

export default function BotHeader({
                                    status,
                                    accountId = 'BOT-00001',
                                    totalProfit = '0.00',
                                    activeSince = '--',
                                    todayProfit = '0.00',
                                  }: Props) {
  const isActive = status === 'active';

  const statusConfig = {
    active: {
      badge: 'success' as const,
      dotColor: '#22C55E',
      bgSoft: '#10251A',
      label: 'ACTIVE',
    },
    suspended: {
      badge: 'warning' as const,
      dotColor: '#FF8F3D',
      bgSoft: '#2A190D',
      label: 'SUSPENDED',
    },
    closed: {
      badge: 'error' as const,
      dotColor: '#EF4444',
      bgSoft: '#281313',
      label: 'CLOSED',
    },
    inactive: {
      badge: 'neutral' as const,
      dotColor: '#A1A4AE',
      bgSoft: '#1B1917',
      label: 'INACTIVE',
    },
    pending: {
      badge: 'neutral' as const,
      dotColor: '#70737E',
      bgSoft: '#111217',
      label: 'PENDING',
    },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
      <div className="relative overflow-hidden rounded-[20px] bg-[#15161C] border border-[#292B33] shadow-sm">
        {/* Subtle top accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#FF7A18] opacity-60" />

        <div className="relative p-5 sm:p-6 pt-6">
          {/* Top Row: Title + Status */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* Left: Icon + Title */}
            <div className="flex items-start gap-4">
              {/* Icon Container */}
              <div
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px]"
                  style={{
                    background: isActive
                        ? 'linear-gradient(135deg, #2A190D 0%, #2A190D 100%)'
                        : '#111217',
                    border: isActive
                        ? '1.5px solid #3A281C'
                        : '1.5px solid #292B33',
                  }}
              >
                <Bot size={26} className={isActive ? 'text-[#FF7A18]' : 'text-[#70737E]'} />
                {isActive && (
                    <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#15161C] border border-[#22C55E] shadow-sm">
                      <div className="h-2 w-2 rounded-full bg-[#22C55E]" />
                    </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-black tracking-tight text-[#F5F5F7] sm:text-[26px]">
                    Bot Trading
                  </h1>
                  <div className="flex items-center gap-1.5 rounded-full bg-[#2A190D] border border-[#3A281C] px-2.5 py-0.5">
                    <Zap size={11} className="text-[#FF7A18]" />
                    <span className="text-[10px] font-extrabold text-[#FF8F3D] tracking-wider">
                    AI POWERED
                  </span>
                  </div>
                </div>

                <p className="mt-1 text-sm font-medium text-[#A1A4AE]">
                  Automated trading with smart algorithms
                </p>

                <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-bold text-[#A1A4AE]">
                  {accountId}
                </span>
                  <span className="h-3 w-px bg-[#292B33]" />
                  <div className="flex items-center gap-1.5">
                    <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: config.dotColor }}
                    />
                    <span
                        className="text-xs font-extrabold"
                        style={{ color: config.dotColor }}
                    >
                    {config.label}
                  </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Status Badge */}
            <div className="flex items-center gap-2">
              <Badge variant={config.badge} className="text-xs font-extrabold tracking-wide">
                {status.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Stats Row */}
          <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
            <div className="rounded-[14px] bg-[#111217] border border-[#292B33] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={13} className="text-[#22C55E]" />
                <span className="text-[10px] font-bold text-[#A1A4AE] uppercase tracking-wider">
                Total Profit
              </span>
              </div>
              <p className="text-[16px] font-black text-[#F5F5F7] sm:text-[18px]">
                {Number(totalProfit).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="ml-1 text-[11px] font-bold text-[#22C55E]">TDX</span>
              </p>
            </div>

            <div className="rounded-[14px] bg-[#111217] border border-[#292B33] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap size={13} className="text-[#FF8F3D]" />
                <span className="text-[10px] font-bold text-[#A1A4AE] uppercase tracking-wider">
                Today
              </span>
              </div>
              <p className="text-[16px] font-black text-[#F5F5F7] sm:text-[18px]">
                +{Number(todayProfit).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
                <span className="ml-1 text-[11px] font-bold text-[#FF8F3D]">TDX</span>
              </p>
            </div>

            <div className="rounded-[14px] bg-[#111217] border border-[#292B33] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar size={13} className="text-[#C99752]" />
                <span className="text-[10px] font-bold text-[#A1A4AE] uppercase tracking-wider">
                Active Since
              </span>
              </div>
              <p className="text-[16px] font-black text-[#F5F5F7] sm:text-[18px]">
                {activeSince}
              </p>
            </div>
          </div>

          {/* Bottom Info Bar */}
          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#2A190D] border border-[#3A281C] px-3 py-2.5">
            <Shield size={13} className="text-[#FF7A18] shrink-0" />
            <p className="text-[11px] font-semibold text-[#FDBA74]">
              Your funds are secured with automated risk management.
              <span className="font-extrabold"> 6.5% monthly returns</span> guaranteed.
            </p>
          </div>
        </div>
      </div>
  );
}