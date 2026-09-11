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
      bgSoft: '#F0FDF4',
      borderSoft: '#BBF7D0',
    },
    suspended: {
      badge: 'warning' as const,
      dotColor: '#F59E0B',
      bgSoft: '#FFFBEB',
      borderSoft: '#FDE68A',
    },
    closed: {
      badge: 'error' as const,
      dotColor: '#EF4444',
      bgSoft: '#FEF2F2',
      borderSoft: '#FECACA',
    },
    pending: {
      badge: 'neutral' as const,
      dotColor: '#64748B',
      bgSoft: '#F8FAFC',
      borderSoft: '#E2E8F0',
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
    <Card className="overflow-hidden rounded-[20px] border border-[#E5E7EB] shadow-sm">
      <div className="h-1 w-full bg-[#FBBF24] opacity-70" />

      <div className="border-b border-[#F1F5F9] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[12px] relative"
              style={{
                background: isActive
                  ? 'linear-gradient(135deg, #FFF7E0 0%, #FEF3C7 100%)'
                  : '#F8FAFC',
                border: isActive
                  ? '1.5px solid #FDE68A'
                  : '1.5px solid #E2E8F0',
              }}
            >
              <Bot size={20} className={isActive ? 'text-[#D97706]' : 'text-[#94A3B8]'} />
            </div>

            <div>
              <h2 className="text-[16px] font-black text-[#101828]">Bot Account</h2>
              <p className="text-[11px] font-medium text-[#64748B]">Automated trading account</p>
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
        <div className="rounded-[16px] border border-[#FDE68A] bg-[#FFFBF0] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={14} className="text-[#D97706]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#B45309]">
              Principal Investment
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[32px] font-black tracking-tight text-[#101828]">
              {Number(account.principal).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-[14px] font-black text-[#D97706]">TDX</span>
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
        <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-[#22C55E]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">
              Monthly Profit
            </span>
          </div>
          <p className="text-[18px] font-black text-[#101828]">
            +{Number(monthlyProfit).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="ml-1 text-[11px] font-bold text-[#22C55E]">TDX</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">6.5% of principal</p>
        </div>

        <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={13} className="text-[#F59E0B]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">
              Total Earned
            </span>
          </div>
          <p className="text-[18px] font-black text-[#101828]">
            +{Number(totalEarned).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span className="ml-1 text-[11px] font-bold text-[#F59E0B]">TDX</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">Since activation</p>
        </div>

        <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-[#3B82F6]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">
              ROI
            </span>
          </div>
          <p className="text-[18px] font-black text-[#101828]">
            {roi}<span className="text-[13px] font-black text-[#3B82F6]">%</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">Return on investment</p>
        </div>

        <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={13} className="text-[#64748B]" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">
              Activated
            </span>
          </div>
          <p className="text-[15px] font-black text-[#101828]">
            {activatedDate || 'Not yet'}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[#94A3B8]">
            {activatedDate ? 'Trading active' : 'Pending activation'}
          </p>
        </div>
      </div>

      {/* Bot ID */}
      <div className="border-t border-[#F1F5F9] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#98A2B3]">Bot ID</p>
            <p className="mt-1 text-[13px] font-black text-[#344054] tracking-wide">
              {account.botId}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyId}
            className="flex items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-[11px] font-bold text-[#344054] transition hover:border-[#175CD3] hover:bg-[#EFF6FF] hover:text-[#175CD3]"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
      </div>
    </Card>
  );
}