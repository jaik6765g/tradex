import React from 'react';
import {
  Activity,
  ArrowUpRight,
  Users,
  Wallet,
} from 'lucide-react';

import Card from '../../../components/ui/Card';
import Skeleton from '../../../components/ui/Skeleton';

import type { BotReferralPerformance } from '../types/bot.types';

type Props = {
  data?: BotReferralPerformance | null;
  loading: boolean;
  errorMessage?: string | null;
};

function formatTDX(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-[12px] border border-[#EAECF0] bg-[#FCFCFD] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#667085]">
          {label}
        </p>

        <span className={`rounded-lg p-2 ${accent}`}>{icon}</span>
      </div>

      <p className="mt-3 text-xl font-black text-[#101828]">{value}</p>
    </div>
  );
}

export default function BotReferralEarnings({
  data,
  loading,
  errorMessage,
}: Props) {
  const directActive = data?.directActive ?? 0;
  const teamActive = data?.teamActive ?? 0;
  const monthlyEarnings = data?.monthlyEarnings ?? '0';
  const previousMonthEarnings = data?.previousMonthEarnings ?? '0';

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[#EAECF0] px-5 py-4">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-[#7A5AF8]" />
          <h2 className="text-[16px] font-black text-[#101828]">
            Referral Performance
          </h2>
        </div>

        <p className="mt-1 text-xs font-medium text-[#667085]">
          Live summary of your current and previous month referral earnings.
        </p>
      </div>

      {errorMessage ? (
        <div className="border-b border-[#FECDCA] bg-[#FEF3F2] px-5 py-3 text-sm font-semibold text-[#B42318]">
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="rounded-[12px] border border-[#EAECF0] p-4"
            >
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-7 w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-2">
          <StatCard
            icon={<Users size={16} className="text-[#7A5AF8]" />}
            label="Direct Active"
            value={String(directActive)}
            accent="bg-[#F4F3FF]"
          />

          <StatCard
            icon={<Users size={16} className="text-[#039855]" />}
            label="Team Active"
            value={String(teamActive)}
            accent="bg-[#ECFDF3]"
          />

          <StatCard
            icon={<Wallet size={16} className="text-[#155EEF]" />}
            label="This Month"
            value={`${formatTDX(monthlyEarnings)} TDX`}
            accent="bg-[#EFF8FF]"
          />

          <StatCard
            icon={<ArrowUpRight size={16} className="text-[#F79009]" />}
            label="Previous Month"
            value={`${formatTDX(previousMonthEarnings)} TDX`}
            accent="bg-[#FFFAEB]"
          />
        </div>
      )}
    </Card>
  );
}