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
      bgSoft: '#F0FDF4',
      label: 'ACTIVE',
    },
    suspended: {
      badge: 'warning' as const,
      dotColor: '#F59E0B',
      bgSoft: '#FFFBEB',
      label: 'SUSPENDED',
    },
    closed: {
      badge: 'error' as const,
      dotColor: '#EF4444',
      bgSoft: '#FEF2F2',
      label: 'CLOSED',
    },
    pending: {
      badge: 'neutral' as const,
      dotColor: '#64748B',
      bgSoft: '#F8FAFC',
      label: 'PENDING',
    },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
      <div className="relative overflow-hidden rounded-[20px] bg-white border border-[#E5E7EB] shadow-sm">
        {/* Subtle top accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#FBBF24] opacity-60" />

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
                        ? 'linear-gradient(135deg, #FFF7E0 0%, #FEF3C7 100%)'
                        : '#F8FAFC',
                    border: isActive
                        ? '1.5px solid #FDE68A'
                        : '1.5px solid #E2E8F0',
                  }}
              >
                <Bot size={26} className={isActive ? 'text-[#D97706]' : 'text-[#94A3B8]'} />
                {isActive && (
                    <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white border border-[#22C55E] shadow-sm">
                      <div className="h-2 w-2 rounded-full bg-[#22C55E]" />
                    </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-black tracking-tight text-[#101828] sm:text-[26px]">
                    Bot Trading
                  </h1>
                  <div className="flex items-center gap-1.5 rounded-full bg-[#FFF7E0] border border-[#FDE68A] px-2.5 py-0.5">
                    <Zap size={11} className="text-[#D97706]" />
                    <span className="text-[10px] font-extrabold text-[#B45309] tracking-wider">
                    AI POWERED
                  </span>
                  </div>
                </div>

                <p className="mt-1 text-sm font-medium text-[#667085]">
                  Automated trading with smart algorithms
                </p>

                <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-bold text-[#475569]">
                  {accountId}
                </span>
                  <span className="h-3 w-px bg-[#E2E8F0]" />
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
            <div className="rounded-[14px] bg-[#F8FAFC] border border-[#E2E8F0] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={13} className="text-[#22C55E]" />
                <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                Total Profit
              </span>
              </div>
              <p className="text-[16px] font-black text-[#101828] sm:text-[18px]">
                {Number(totalProfit).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="ml-1 text-[11px] font-bold text-[#22C55E]">TDX</span>
              </p>
            </div>

            <div className="rounded-[14px] bg-[#F8FAFC] border border-[#E2E8F0] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap size={13} className="text-[#F59E0B]" />
                <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                Today
              </span>
              </div>
              <p className="text-[16px] font-black text-[#101828] sm:text-[18px]">
                +{Number(todayProfit).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
                <span className="ml-1 text-[11px] font-bold text-[#F59E0B]">TDX</span>
              </p>
            </div>

            <div className="rounded-[14px] bg-[#F8FAFC] border border-[#E2E8F0] p-3 sm:p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar size={13} className="text-[#3B82F6]" />
                <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                Active Since
              </span>
              </div>
              <p className="text-[16px] font-black text-[#101828] sm:text-[18px]">
                {activeSince}
              </p>
            </div>
          </div>

          {/* Bottom Info Bar */}
          <div className="mt-4 flex items-center gap-2 rounded-[10px] bg-[#FFF7E0] border border-[#FDE68A] px-3 py-2.5">
            <Shield size={13} className="text-[#D97706] shrink-0" />
            <p className="text-[11px] font-semibold text-[#92400E]">
              Your funds are secured with automated risk management.
              <span className="font-extrabold"> 6.5% monthly returns</span> guaranteed.
            </p>
          </div>
        </div>
      </div>
  );
}