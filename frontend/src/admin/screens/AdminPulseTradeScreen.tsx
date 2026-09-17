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
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#70737E]" />
          <input
            type="text"
            placeholder="Search by trade ID, user, wallet, or symbol"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#34343E] bg-[#15161C] pl-9 pr-3 py-2 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminPulseTradeFilterStatus)}
          className="rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
        >
          {PULSE_TRADE_STATUS_OPTIONS.map((option) => (
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
    <tr className="align-top transition-colors hover:bg-[#111217]">
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-mono font-bold">{trade.id.slice(0, 10)}...</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">User: {trade.userId.slice(0, 10)}...</p>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-mono">{trade.walletAddress ? formatAddress(trade.walletAddress) : '—'}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-bold">{trade.symbol}</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">{formatPulseDuration(trade.duration)}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={trade.direction === 'LONG' ? 'success' : 'warning'}>{trade.direction}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-semibold">Stake: {formatTokenAmount(trade.stake)}</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">Fee: {formatTokenAmount(trade.fee)}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getPulseTradeStatusBadgeVariant(trade.status)}>{formatPulseTradeStatus(trade.status)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getPulseTradeResultBadgeVariant(trade.result ?? undefined)}>{trade.result || '—'}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] cursor-help">{formatRelativeTime(trade.createdAt)}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
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
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Pulse Trade</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">Monitor pulse trades, liquidity pressure, and settlement health</p>
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
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <h2 className="text-xs font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Overview</h2>
        {metricsLoading ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={`metric-skeleton-${i}`} className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-3 h-7 w-24" />
              </div>
            ))}
          </div>
        ) : metricsError ? (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[#4A2323] bg-[#281313] p-3 text-xs text-[#F87171]">
            <AlertCircle size={15} />
            {metricsError}
          </div>
        ) : metrics ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Total Trades</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{metrics.totalTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Open Trades</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{metrics.openTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Settled Trades</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{metrics.settledTrades}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Settlement Delayed</p>
              <p className="mt-1 text-xl font-bold text-[#FF8F3D]">{metrics.settlementDelayed}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Settlement Failed</p>
              <p className="mt-1 text-xl font-bold text-[#EF4444]">{metrics.settlementFailed}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Total Stake</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{formatTokenAmount(metrics.totalStake)}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Total Payout</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{formatTokenAmount(metrics.totalPayout)}</p>
            </div>
            <div className="rounded-[14px] border border-[#202229] bg-[#15161C] p-4">
              <p className="text-xs text-[#A1A4AE]">Today Volume</p>
              <p className="mt-1 text-xl font-bold text-[#F5F5F7]">{formatTokenAmount(metrics.todaysTradeVolume)}</p>
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
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
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
        <section className="overflow-hidden rounded-[16px] border border-[#292B33] bg-[#15161C]">
          {trades.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#E4E5E8]">No pulse trades found</p>
              <p className="mt-1 text-xs text-[#A1A4AE]">Try changing search text or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full divide-y divide-[#202229]">
                  <thead className="bg-[#15161C]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Trade</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Symbol / Duration</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Direction</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Stake / Fee</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Result</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1B1917] bg-[#15161C]">
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

      {/* Trade Detail Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[16px] border border-[#292B33] bg-[#15161C] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-[#F5F5F7]">Trade Details</h2>
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => setSelectedTrade(null)}>
                Close
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-[#E4E5E8] sm:grid-cols-3">
              <p><span className="text-[#A1A4AE]">Trade ID:</span> <span className="font-mono text-[#F5F5F7]">{selectedTrade.id}</span></p>
              <p><span className="text-[#A1A4AE]">User:</span> <span className="font-mono text-[#F5F5F7]">{selectedTrade.userId}</span></p>
              <p><span className="text-[#A1A4AE]">Wallet:</span> <span className="font-mono text-[#F5F5F7]">{selectedTrade.walletAddress || '—'}</span></p>
              <p><span className="text-[#A1A4AE]">Market:</span> <span className="font-bold text-[#F5F5F7]">{selectedTrade.symbol} / {formatPulseDuration(selectedTrade.duration)}</span></p>
              <p><span className="text-[#A1A4AE]">Direction:</span> <Badge variant={selectedTrade.direction === 'LONG' ? 'success' : 'warning'}>{selectedTrade.direction}</Badge></p>
              <p><span className="text-[#A1A4AE]">Status:</span> <Badge variant={getPulseTradeStatusBadgeVariant(selectedTrade.status)}>{formatPulseTradeStatus(selectedTrade.status)}</Badge></p>
              <p><span className="text-[#A1A4AE]">Result:</span> <Badge variant={getPulseTradeResultBadgeVariant(selectedTrade.result ?? undefined)}>{selectedTrade.result || '—'}</Badge></p>
              <p><span className="text-[#A1A4AE]">Stake:</span> <span className="font-bold text-[#F5F5F7]">{formatTokenAmount(selectedTrade.stake)}</span></p>
              <p><span className="text-[#A1A4AE]">Fee:</span> <span className="font-bold text-[#F5F5F7]">{formatTokenAmount(selectedTrade.fee)}</span></p>
              <p><span className="text-[#A1A4AE]">Net Stake:</span> <span className="font-bold text-[#F5F5F7]">{formatTokenAmount(selectedTrade.netStake)}</span></p>
              <p><span className="text-[#A1A4AE]">Payout:</span> <span className="font-bold text-[#F5F5F7]">{selectedTrade.payout ? formatTokenAmount(selectedTrade.payout) : '—'}</span></p>
              <p><span className="text-[#A1A4AE]">PNL:</span> <span className="font-bold text-[#F5F5F7]">{selectedTrade.pnl ? formatTokenAmount(selectedTrade.pnl) : '—'}</span></p>
              <p><span className="text-[#A1A4AE]">Retries:</span> <span className="font-bold text-[#F5F5F7]">{selectedTrade.settlementRetryCount}</span></p>
              <p><span className="text-[#A1A4AE]">Entry Price:</span> <span className="font-mono text-[#F5F5F7]">{selectedTrade.entryPrice}</span></p>
              <p><span className="text-[#A1A4AE]">Expiry Price:</span> <span className="font-mono text-[#F5F5F7]">{selectedTrade.expiryPrice || '—'}</span></p>
              <p><span className="text-[#A1A4AE]">Entry At:</span> <span className="font-semibold text-[#F5F5F7]">{formatDateTime(selectedTrade.entryAt)}</span></p>
              <p><span className="text-[#A1A4AE]">Expires At:</span> <span className="font-semibold text-[#F5F5F7]">{formatDateTime(selectedTrade.expiresAt)}</span></p>
              <p><span className="text-[#A1A4AE]">Settled At:</span> <span className="font-semibold text-[#F5F5F7]">{formatDateTime(selectedTrade.settledAt)}</span></p>
              {selectedTrade.settlementFailureReason && (
                <div className="sm:col-span-3 mt-2 rounded-[10px] border border-[#4A2323] bg-[#281313] p-2 text-[#F87171]">
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