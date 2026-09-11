import React from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Wallet,
  XCircle,
} from 'lucide-react';

import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Skeleton from '../../../components/ui/Skeleton';

import type {
  BotActivityFilter,
  BotActivityItem,
} from '../types/bot.types';

type Props = {
  items: BotActivityItem[];
  filter: BotActivityFilter;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onFilterChange: (filter: BotActivityFilter) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  errorMessage?: string | null;
};

const FILTERS: Array<{
  value: BotActivityFilter;
  label: string;
}> = [
  { value: 'ALL', label: 'All Activity' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'STATUS', label: 'Status' },
  { value: 'TRADE', label: 'Trade' },
];

function formatAmount(value: string | null | undefined): string {
  const numeric = Number(value ?? '0');

  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDirectionMeta(direction: BotActivityItem['direction']): {
  icon: React.ReactNode;
  amountClassName: string;
} {
  if (direction === 'CREDIT') {
    return {
      icon: <ArrowDownLeft size={16} className="text-[#039855]" />,
      amountClassName: 'text-[#039855]',
    };
  }

  if (direction === 'DEBIT') {
    return {
      icon: <ArrowUpRight size={16} className="text-[#D92D20]" />,
      amountClassName: 'text-[#D92D20]',
    };
  }

  return {
    icon: <Activity size={16} className="text-[#475467]" />,
    amountClassName: 'text-[#475467]',
  };
}

function getStatusMeta(status: BotActivityItem['status']): {
  label: string;
  className: string;
  icon: React.ReactNode;
} {
  if (status === 'COMPLETED') {
    return {
      label: 'Completed',
      className:
        'border border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]',
      icon: <CheckCircle2 size={12} />,
    };
  }

  if (status === 'PENDING') {
    return {
      label: 'Pending',
      className:
        'border border-[#FEE4A3] bg-[#FFFAEB] text-[#B54708]',
      icon: <RefreshCw size={12} />,
    };
  }

  return {
    label: status,
    className:
      'border border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]',
    icon: <XCircle size={12} />,
  };
}

export default function BotTransactionHistory({
  items,
  filter,
  loading,
  loadingMore,
  hasMore,
  onFilterChange,
  onLoadMore,
  onRetry,
  errorMessage,
}: Props) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[#EAECF0] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Wallet size={18} className="text-[#155EEF]" />
            <h2 className="text-[16px] font-black text-[#101828]">
              Bot Activity
            </h2>
          </div>

          <div className="relative w-full sm:w-[210px]">
            <select
              value={filter}
              onChange={(event) => {
                onFilterChange(event.target.value as BotActivityFilter);
              }}
              className="h-10 w-full appearance-none rounded-[10px] border border-[#D0D5DD] bg-white px-3 pr-9 text-sm font-semibold text-[#344054] outline-none transition focus:border-[#1570EF] focus:ring-2 focus:ring-[#D1E9FF]"
            >
              {FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#667085]"
            />
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-[#FECDCA] bg-[#FEF3F2] px-5 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-[#B42318]">{errorMessage}</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 px-5 py-5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="rounded-[12px] border border-[#EAECF0] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-[45%]" />
                  <Skeleton className="h-3 w-[80%]" />
                  <Skeleton className="h-3 w-[35%]" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[#667085]">
            No bot activity found for this filter yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-5 py-5">
          {items.map((item) => {
            const directionMeta = getDirectionMeta(item.direction);
            const statusMeta = getStatusMeta(item.status);

            return (
              <article
                key={item.id}
                className="rounded-[12px] border border-[#EAECF0] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {directionMeta.icon}

                      <p className="truncate text-sm font-black text-[#101828]">
                        {item.title}
                      </p>
                    </div>

                    <p className="mt-1 text-xs font-medium text-[#667085]">
                      {item.description}
                    </p>

                    <p className="mt-2 text-[11px] font-semibold text-[#98A2B3]">
                      {formatDateTime(item.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-black ${directionMeta.amountClassName}`}>
                      {item.direction === 'DEBIT' ? '-' : item.direction === 'CREDIT' ? '+' : ''}
                      {formatAmount(item.amount)} TDX
                    </p>

                    <span
                      className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusMeta.className}`}
                    >
                      {statusMeta.icon}
                      {statusMeta.label}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}

          {hasMore ? (
            <div className="pt-1 text-center">
              <Button
                size="sm"
                variant="secondary"
                loading={loadingMore}
                onClick={onLoadMore}
              >
                Load More Activity
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}