// frontend/src/admin/screens/AdminPulseTradeScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Eye, AlertCircle } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminPulseTrade, AdminPulseTradeFilterStatus, AdminPulseTradeMetrics } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const PULSE_TRADE_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminPulseTradeFilterStatus;
}> = [
  { label: 'All Statuses', value: 'ALL' },
  { label: 'Created', value: 'CREATED' },
  { label: 'Validating', value: 'VALIDATING' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Entry Closed', value: 'ENTRY_CLOSED' },
  { label: 'Expiring', value: 'EXPIRING' },
  { label: 'Settling', value: 'SETTLING' },
  { label: 'Settlement Delayed', value: 'SETTLEMENT_DELAYED' },
  { label: 'Settled', value: 'SETTLED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Settlement Failed', value: 'SETTLEMENT_FAILED' },
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

function formatAddress(address: string): string {
  if (!address) return '—';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(amount: string | number, symbol: 'TDX' | 'USDT' = 'TDX'): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `0.00 ${symbol}`;
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${symbol}`;
}

function formatPulseTradeStatus(status?: string): string {
  if (!status) return 'Unknown';
  return status.toLowerCase().split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function formatPulseDuration(duration?: string): string {
  if (!duration) return '—';
  const normalized = duration.trim().toUpperCase();
  const matched = normalized.match(/^(\d+)([SMH])$/);
  if (!matched) return normalized;
  const [, value, unit] = matched;
  if (unit === 'S') return `${value}s`;
  if (unit === 'M') return `${value}m`;
  return `${value}h`;
}

function getPulseTradeStatusBadgeVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = status.trim().toUpperCase();
  if (!normalized) return 'neutral';
  if (normalized === 'SETTLED') return 'success';
  if (normalized === 'REJECTED' || normalized === 'CANCELLED' || normalized === 'SETTLEMENT_FAILED') return 'error';
  if (normalized === 'SETTLEMENT_DELAYED' || normalized === 'EXPIRING') return 'warning';
  return 'info';
}

function getPulseTradeResultBadgeVariant(result?: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (!result) return 'neutral';
  if (result === 'WIN') return 'success';
  if (result === 'LOSS') return 'error';
  return 'warning';
}

function PulseTradeFilters({
  searchInput,
  status,
  limit,
  onSearchInputChange,
  onSearchSubmit,
  onStatusChange,
  onLimitChange,
  onReset,
}: {
  searchInput: string;
  status: AdminPulseTradeFilterStatus;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: AdminPulseTradeFilterStatus) => void;
  onLimitChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
          <input
            type="text"
            placeholder="Search by trade ID, user, wallet, or symbol"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 py-2 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminPulseTradeFilterStatus)}
          className="rounded-[10px] border border-[#D0D5DD] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
        >
          {PULSE_TRADE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="rounded-[10px] border border-[#D0D5DD] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
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

function PulseTradeTableRow({
  trade,
  isLoadingDetail,
  onView,
}: {
  trade: AdminPulseTrade;
  isLoadingDetail: boolean;
  onView: (tradeId: string) => Promise<void>;
}) {
  return (
    <tr className="align-top transition-colors hover:bg-[#F8FAFC]">
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-mono font-bold">{trade.id.slice(0, 10)}...</p>
        <p className="mt-1 text-[10px] text-[#667085]">User: {trade.userId.slice(0, 10)}...</p>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">{trade.walletAddress ? formatAddress(trade.walletAddress) : '—'}</td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-bold">{trade.symbol}</p>
        <p className="mt-1 text-[10px] text-[#667085]">{formatPulseDuration(trade.duration)}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={trade.direction === 'LONG' ? 'success' : 'warning'}>{trade.direction}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-semibold">Stake: {formatTokenAmount(trade.stake)}</p>
        <p className="mt-1 text-[10px] text-[#667085]">Fee: {formatTokenAmount(trade.fee)}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getPulseTradeStatusBadgeVariant(trade.status)}>{formatPulseTradeStatus(trade.status)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getPulseTradeResultBadgeVariant(trade.result ?? undefined)}>{trade.result || '—'}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] cursor-help">{formatRelativeTime(trade.createdAt)}</td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <Button variant="secondary" size="sm" className="h-7 px-2.5 text-[11px]" loading={isLoadingDetail} onClick={() => void onView(trade.id)}>
          <Eye size={12} className="mr-1" />
          View
        </Button>
      </td>
    </tr>
  );
}

export default function AdminPulseTradeScreen() {
  const [trades, setTrades] = useState<AdminPulseTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminPulseTradeFilterStatus>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const [metrics, setMetrics] = useState<AdminPulseTradeMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [selectedTrade, setSelectedTrade] = useState<AdminPulseTrade | null>(null);
  const [selectedTradeLoadingId, setSelectedTradeLoadingId] = useState<string | null>(null);

  const loadTrades = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await AdminService.getAdminPulseTrades({
        limit,
        offset,
        search,
        status: status === 'ALL' ? undefined : status,
      });
      setTrades(result.trades);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setTrades([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, search, status]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const data = await AdminService.getAdminPulseTradeMetrics();
      setMetrics(data);
    } catch (err) {
      setMetricsError(AdminService.getErrorMessage(err));
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadTrades({ withLoader: true }), loadMetrics()]);
  }, [loadTrades, loadMetrics]);

  const applySearch = useCallback(() => {
    setSearch(searchInput.trim());
    setOffset(0);
  }, [searchInput]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setStatus('ALL');
    setLimit(20);
    setOffset(0);
    setSelectedTrade(null);
  }, []);

  const handleViewTrade = useCallback(async (tradeId: string) => {
    setSelectedTradeLoadingId(tradeId);
    try {
      const trade = await AdminService.getAdminPulseTradeById(tradeId);
      setSelectedTrade(trade);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
    } finally {
      setSelectedTradeLoadingId(null);
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + trades.length, total);

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Pulse Trade</h1>
            <p className="mt-0.5 text-xs text-[#667085]">Monitor pulse trades, liquidity pressure, and settlement health</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadTrades({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {/* Metrics */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#475467]">Overview</h2>
        {metricsLoading ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`metric-skeleton-${i}`} className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-3 h-7 w-24" />
              </div>
            ))}
          </div>
        ) : metricsError ? (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B42318]">
            <AlertCircle size={15} />
            {metricsError}
          </div>
        ) : metrics ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Total Trades</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{metrics.totalTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Open Trades</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{metrics.openTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Settled Trades</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{metrics.settledTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Settlement Delayed</p>
              <p className="mt-1 text-xl font-bold text-[#F59E0B]">{metrics.settlementDelayed}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Settlement Failed</p>
              <p className="mt-1 text-xl font-bold text-[#EF4444]">{metrics.settlementFailed}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Total Stake</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{formatTokenAmount(metrics.totalStake)}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Total Payout</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{formatTokenAmount(metrics.totalPayout)}</p>
            </div>
            <div className="rounded-[14px] border border-[#EAECF0] bg-white p-4">
              <p className="text-xs text-[#667085]">Today Volume</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{formatTokenAmount(metrics.todaysTradeVolume)}</p>
            </div>
          </div>
        ) : null}
      </section>

      {/* Filters */}
      <PulseTradeFilters
        searchInput={searchInput}
        status={status}
        limit={limit}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={applySearch}
        onStatusChange={(val) => { setStatus(val); setOffset(0); }}
        onLimitChange={(val) => { setLimit(val); setOffset(0); }}
        onReset={resetFilters}
      />

      {/* Loading */}
      {loading && !trades.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`trade-skeleton-${i}`} className="grid grid-cols-9 gap-2">
                {Array.from({ length: 9 }).map((__, j) => (
                  <Skeleton key={`trade-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="Unable to load pulse trades" description={error} onRetry={() => void loadTrades({ withLoader: true })} />
      )}

      {/* Table */}
      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {trades.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#344054]">No pulse trades found</p>
              <p className="mt-1 text-xs text-[#667085]">Try changing search text or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Trade</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Symbol / Duration</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Direction</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Stake / Fee</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Result</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {trades.map((trade) => (
                      <PulseTradeTableRow
                        key={trade.id}
                        trade={trade}
                        isLoadingDetail={selectedTradeLoadingId === trade.id}
                        onView={handleViewTrade}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EAECF0] px-3 py-2.5">
                <p className="text-xs text-[#667085]">
                  Showing <span className="font-bold text-[#111827]">{rangeStart}-{rangeEnd}</span> of{' '}
                  <span className="font-bold text-[#111827]">{total}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" disabled={!canGoPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>
                    Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#344054]">Page {currentPage} of {totalPages}</span>
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" disabled={!canGoNext} onClick={() => setOffset(offset + limit)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* Trade Detail Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[16px] border border-[#E5E7EB] bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-[#111827]">Trade Details</h2>
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setSelectedTrade(null)}>
                Close
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-[#344054] sm:grid-cols-3">
              <p><span className="text-[#667085]">Trade ID:</span> <span className="font-mono text-[#111827]">{selectedTrade.id}</span></p>
              <p><span className="text-[#667085]">User:</span> <span className="font-mono text-[#111827]">{selectedTrade.userId}</span></p>
              <p><span className="text-[#667085]">Wallet:</span> <span className="font-mono text-[#111827]">{selectedTrade.walletAddress || '—'}</span></p>
              <p><span className="text-[#667085]">Market:</span> <span className="font-bold text-[#111827]">{selectedTrade.symbol} / {formatPulseDuration(selectedTrade.duration)}</span></p>
              <p><span className="text-[#667085]">Direction:</span> <Badge variant={selectedTrade.direction === 'LONG' ? 'success' : 'warning'}>{selectedTrade.direction}</Badge></p>
              <p><span className="text-[#667085]">Status:</span> <Badge variant={getPulseTradeStatusBadgeVariant(selectedTrade.status)}>{formatPulseTradeStatus(selectedTrade.status)}</Badge></p>
              <p><span className="text-[#667085]">Result:</span> <Badge variant={getPulseTradeResultBadgeVariant(selectedTrade.result ?? undefined)}>{selectedTrade.result || '—'}</Badge></p>
              <p><span className="text-[#667085]">Stake:</span> <span className="font-bold text-[#111827]">{formatTokenAmount(selectedTrade.stake)}</span></p>
              <p><span className="text-[#667085]">Fee:</span> <span className="font-bold text-[#111827]">{formatTokenAmount(selectedTrade.fee)}</span></p>
              <p><span className="text-[#667085]">Net Stake:</span> <span className="font-bold text-[#111827]">{formatTokenAmount(selectedTrade.netStake)}</span></p>
              <p><span className="text-[#667085]">Payout:</span> <span className="font-bold text-[#111827]">{selectedTrade.payout ? formatTokenAmount(selectedTrade.payout) : '—'}</span></p>
              <p><span className="text-[#667085]">PNL:</span> <span className="font-bold text-[#111827]">{selectedTrade.pnl ? formatTokenAmount(selectedTrade.pnl) : '—'}</span></p>
              <p><span className="text-[#667085]">Retries:</span> <span className="font-bold text-[#111827]">{selectedTrade.settlementRetryCount}</span></p>
              <p><span className="text-[#667085]">Entry Price:</span> <span className="font-mono text-[#111827]">{selectedTrade.entryPrice}</span></p>
              <p><span className="text-[#667085]">Expiry Price:</span> <span className="font-mono text-[#111827]">{selectedTrade.expiryPrice || '—'}</span></p>
              <p><span className="text-[#667085]">Entry At:</span> <span className="font-semibold text-[#111827]">{formatDateTime(selectedTrade.entryAt)}</span></p>
              <p><span className="text-[#667085]">Expires At:</span> <span className="font-semibold text-[#111827]">{formatDateTime(selectedTrade.expiresAt)}</span></p>
              <p><span className="text-[#667085]">Settled At:</span> <span className="font-semibold text-[#111827]">{formatDateTime(selectedTrade.settledAt)}</span></p>
              {selectedTrade.settlementFailureReason && (
                <div className="sm:col-span-3 mt-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-2 text-[#B42318]">
                  <p className="text-[11px] font-semibold">Failure Reason:</p>
                  <p className="text-xs">{selectedTrade.settlementFailureReason}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}