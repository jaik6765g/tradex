// src/bot/components/BotAccountCard.tsx

import React from 'react';
import { Bot, Copy, TrendingUp, Calendar, Wallet, Zap, ShieldCheck } from 'lucide-react';

import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';

import type { BotAccount } from '../types/bot.types';

type Props = {
  account: BotAccount;
  monthlyProfit?: string;
  totalEarned?: string;
  roi?: string;
};

export default function BotAccountCard({
  account,
  monthlyProfit = '0.00',
  totalEarned = '0.00',
  roi = '0.0',
}: Props) {
  const isActive = account.status === 'active';

  const statusConfig = {
    active: {
      badge: 'success' as const,
      dotColor: '#22C55E',
      bgSoft: '#10251A',
      borderSoft: '#123A24',
    },
    suspended: {
      badge: 'warning' as const,
      dotColor: '#FF8F3D',
      bgSoft: '#2A190D',
      borderSoft: '#3A281C',
    },
    closed: {
      badge: 'error' as const,
      dotColor: '#EF4444',
      bgSoft: '#281313',
      borderSoft: '#4A2323',
    },
    inactive: {
      badge: 'neutral' as const,
      dotColor: '#A1A4AE',
      bgSoft: '#1B1917',
      borderSoft: '#292B33',
    },
    pending: {
      badge: 'neutral' as const,
      dotColor: '#70737E',
      bgSoft: '#111217',
      borderSoft: '#292B33',
    },
  };

  const config = statusConfig[account.status] || statusConfig.pending;

  const handleCopyId = () => {
    if (account.botId) {
      navigator.clipboard?.writeText(account.botId);
    }
  };

  const activatedDate = account.activatedAt
    ? new Date(account.activatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <Card className="overflow-hidden rounded-[20px] border border-[#292B33] shadow-sm">
      <div className="h-1 w-full bg-[#FF7A18] opacity-70" />

      <div className="border-b border-[#1B1917] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[12px] relative"
              style={{
                background: isActive
                  ? 'linear-gradient(135deg, #2A190D 0%, #2A190D 100%)'
                  : '#111217',
                border: isActive
                  ? '1.5px solid #3A281C'
                  : '1.5px solid #292B33',
              }}
            >
              <Bot size={20} className={isActive ? 'text-[#FF7A18]' : 'text-[#70737E]'} />
            </div>

            <div>
              <h2 className="text-[16px] font-black text-[#F5F5F7]">Bot Account</h2>
              <p className="text-[11px] font-medium text-[#A1A4AE]">Automated trading account</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: config.dotColor }} />
              <span className="text-[11px] font-extrabold" style={{ color: config.dotColor }}>
                {account.status.toUpperCase()}
              </span>
            </div>
            <Badge variant={config.badge} className="text-[10px] font-extrabold">
              {account.status.toUpperCase()}
            </Badge>
          </div>
        </div>
      </div>

      {/* Principal */}
      <div className="px-5 pt-5 pb-4">
        <div className="rounded-[16px] border border-[#3A281C] bg-[#2A190D] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={14} className="text-[#FF7A18]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#FF8F3D]">
              Principal Investment
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[32px] font-black tracking-tight text-[#F5F5F7]">
              {Number(account.principal).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-[14px] font-black text-[#FF7A18]">TDX</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-[#22C55E]" />
            <span className="text-[11px] font-semibold text-[#22C55E]">
              Secured & Protected
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 px-5 pb-5">
        <div className="rounded-[14px] border border-[#292B33] bg-[#111217] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-[#22C55E]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A4AE]">
              Monthly Profit
            </span>
          </div>
          <p className="text-[18px] font-black text-[#F5F5F7]">
            +{Number(monthlyProfit).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="ml-1 text-[11px] font-bold text-[#22C55E]">TDX</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#70737E]">6.5% of principal</p>
        </div>

        <div className="rounded-[14px] border border-[#292B33] bg-[#111217] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={13} className="text-[#FF8F3D]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A4AE]">
              Total Earned
            </span>
          </div>
          <p className="text-[18px] font-black text-[#F5F5F7]">
            +{Number(totalEarned).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="ml-1 text-[11px] font-bold text-[#FF8F3D]">TDX</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#70737E]">Since activation</p>
        </div>

        <div className="rounded-[14px] border border-[#292B33] bg-[#111217] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-[#C99752]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A4AE]">
              ROI
            </span>
          </div>
          <p className="text-[18px] font-black text-[#F5F5F7]">
            {roi}<span className="text-[13px] font-black text-[#C99752]">%</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#70737E]">Return on investment</p>
        </div>

        <div className="rounded-[14px] border border-[#292B33] bg-[#111217] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={13} className="text-[#A1A4AE]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A4AE]">
              Activated
            </span>
          </div>
          <p className="text-[15px] font-black text-[#F5F5F7]">
            {activatedDate || 'Not yet'}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#70737E]">
            {activatedDate ? 'Trading active' : 'Pending activation'}
          </p>
        </div>
      </div>

      {/* Bot ID */}
      <div className="border-t border-[#1B1917] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#70737E]">Bot ID</p>
            <p className="mt-1 text-[13px] font-black text-[#E4E5E8] tracking-wide">
              {account.botId}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyId}
            className="flex items-center gap-1.5 rounded-lg border border-[#34343E] bg-[#15161C] px-3 py-2 text-[11px] font-bold text-[#E4E5E8] transition hover:border-[#C99752] hover:bg-[#211810] hover:text-[#C99752]"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
      </div>
    </Card>
  );
}