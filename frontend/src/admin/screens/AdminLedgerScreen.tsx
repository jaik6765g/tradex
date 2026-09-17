// frontend/src/admin/screens/AdminLedgerScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminLedgerEntry, AdminLedgerFilterType, AdminLedgerType } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const LEDGER_TYPE_OPTIONS: Array<{ label: string; value: AdminLedgerFilterType }> = [
  { label: 'All Types', value: 'ALL' },
  { label: 'Deposit', value: 'DEPOSIT' },
  { label: 'Withdrawal', value: 'WITHDRAWAL' },
  { label: 'Game Entry', value: 'GAME_ENTRY' },
  { label: 'Game Win', value: 'GAME_WIN' },
  { label: 'Game Fee', value: 'GAME_FEE' },
  { label: 'Trade Entry', value: 'TRADE_ENTRY' },
  { label: 'Trade Profit', value: 'TRADE_PROFIT' },
  { label: 'Trade Loss', value: 'TRADE_LOSS' },
  { label: 'Trade Draw', value: 'TRADE_DRAW' },
  { label: 'Trade Fee', value: 'TRADE_FEE' },
  { label: 'Withdrawal Lock', value: 'WITHDRAWAL_LOCK' },
  { label: 'Withdrawal Release', value: 'WITHDRAWAL_RELEASE' },
  { label: 'Admin Adjustment', value: 'ADMIN_ADJUSTMENT' },
];

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTime(value);
}

function formatTokenAmount(amount: string | number, symbol: 'TDX' | 'USDT' = 'TDX'): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `0.00 ${symbol}`;
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${symbol}`;
}

function formatLedgerType(type: AdminLedgerType): string {
  return type.toLowerCase().split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function getLedgerTypeBadgeVariant(type: AdminLedgerType): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (type === 'DEPOSIT' || type === 'GAME_WIN' || type === 'TRADE_PROFIT' || type === 'WITHDRAWAL_RELEASE') return 'success';
  if (type === 'WITHDRAWAL' || type === 'GAME_ENTRY' || type === 'TRADE_ENTRY' || type === 'TRADE_LOSS') return 'warning';
  if (type === 'GAME_FEE' || type === 'TRADE_FEE' || type === 'WITHDRAWAL_LOCK') return 'info';
  if (type === 'ADMIN_ADJUSTMENT') return 'error';
  return 'neutral';
}

function LedgerFilters({
  searchInput,
  type,
  limit,
  onSearchInputChange,
  onSearchSubmit,
  onTypeChange,
  onLimitChange,
  onReset,
}: {
  searchInput: string;
  type: AdminLedgerFilterType;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onTypeChange: (value: AdminLedgerFilterType) => void;
  onLimitChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#70737E]" />
          <input
            type="text"
            placeholder="Search by user, reference, description, or wallet"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#34343E] bg-[#15161C] pl-9 pr-3 py-2 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
          />
        </div>

        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as AdminLedgerFilterType)}
          className="rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
        >
          {LEDGER_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size} / page</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" size="sm" className="h-9 px-3 text-xs">Search</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 px-3 text-xs" onClick={onReset}>Reset</Button>
        </div>
      </form>
    </section>
  );
}

function LedgerTableRow({ entry }: { entry: AdminLedgerEntry }) {
  return (
    <tr className="align-top transition-colors hover:bg-[#111217]">
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-mono font-bold">{entry.id.slice(0, 10)}...</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">User: {entry.userId.slice(0, 10)}...</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getLedgerTypeBadgeVariant(entry.type)}>{formatLedgerType(entry.type)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-bold">{formatTokenAmount(entry.amount)}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <div className="space-y-0.5">
          <p><span className="text-[#A1A4AE]">Before:</span> <span className="font-semibold">{formatTokenAmount(entry.balanceBefore)}</span></p>
          <p><span className="text-[#A1A4AE]">After:</span> <span className="font-semibold">{formatTokenAmount(entry.balanceAfter)}</span></p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <div className="space-y-0.5">
          <p className="font-mono">{entry.referenceId || '—'}</p>
          <p className="text-[10px] text-[#A1A4AE]">{entry.referenceType || '—'}</p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">{entry.description || '—'}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] cursor-help">{formatRelativeTime(entry.createdAt)}</td>
    </tr>
  );
}

export default function AdminLedgerScreen() {
  const [entries, setEntries] = useState<AdminLedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<AdminLedgerFilterType>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const loadLedger = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await AdminService.getAdminLedger({ limit, offset, search, type });
      setEntries(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setEntries([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, search, type]);

  useEffect(() => {
    void loadLedger({ withLoader: true });
  }, [loadLedger]);

  const applySearch = useCallback(() => {
    setSearch(searchInput.trim());
    setOffset(0);
  }, [searchInput]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setType('ALL');
    setLimit(20);
    setOffset(0);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + entries.length, total);

  return (
    <div className="space-y-3">
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Ledger</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">Review immutable balance movements across deposits, withdrawals, games, and trades</p>
          </div>
          <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" loading={refreshing} onClick={() => void loadLedger({ withLoader: false })}>
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </section>

      <LedgerFilters
        searchInput={searchInput}
        type={type}
        limit={limit}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={applySearch}
        onTypeChange={(val) => { setType(val); setOffset(0); }}
        onLimitChange={(val) => { setLimit(val); setOffset(0); }}
        onReset={resetFilters}
      />

      {loading && !entries.length && (
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`ledger-skeleton-${i}`} className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }).map((__, j) => (
                  <Skeleton key={`ledger-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && error && (
        <ErrorState title="Unable to load ledger entries" description={error} onRetry={() => void loadLedger({ withLoader: true })} />
      )}

      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#292B33] bg-[#15161C]">
          {entries.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#E4E5E8]">No ledger entries found</p>
              <p className="mt-1 text-xs text-[#A1A4AE]">Try changing type, search text, or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1160px] w-full divide-y divide-[#202229]">
                  <thead className="bg-[#15161C]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Entry / User</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Type</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Amount</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Balance</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Reference</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Description</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1B1917] bg-[#15161C]">
                    {entries.map((entry) => (
                      <LedgerTableRow key={entry.id} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#202229] px-3 py-2.5">
                <p className="text-xs text-[#A1A4AE]">
                  Showing <span className="font-bold text-[#F5F5F7]">{rangeStart}-{rangeEnd}</span> of{' '}
                  <span className="font-bold text-[#F5F5F7]">{total}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" disabled={!canGoPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
                    Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#E4E5E8]">Page {currentPage} of {totalPages}</span>
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" disabled={!canGoNext} onClick={() => setOffset(offset + limit)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}