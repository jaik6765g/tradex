// frontend/src/admin/screens/AdminDepositsScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminDeposit, AdminDepositFilterStatus, AdminDepositStatus } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const DEPOSIT_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminDepositFilterStatus;
}> = [
  { label: 'All Statuses', value: 'ALL' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Confirming', value: 'CONFIRMING' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Failed', value: 'FAILED' },
];

const DEPOSIT_STATUS_BADGE_VARIANTS: Record<
  AdminDepositStatus,
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  PENDING: 'warning',
  CONFIRMING: 'warning',
  VERIFIED: 'info',
  COMPLETED: 'success',
  FAILED: 'error',
};

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

function formatDepositStatus(status: AdminDepositStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function DepositsFilters({
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
  status: AdminDepositFilterStatus;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: AdminDepositFilterStatus) => void;
  onLimitChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
          <input
            type="text"
            placeholder="Search by deposit ID, user ID, tx hash, or chain"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 py-2 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminDepositFilterStatus)}
          className="rounded-[10px] border border-[#D0D5DD] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
        >
          {DEPOSIT_STATUS_OPTIONS.map((option) => (
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

function DepositTableRow({
  deposit,
  isUpdatingStatus,
  isCrediting,
  isAnyActionRunning,
  onUpdateStatus,
  onCredit,
}: {
  deposit: AdminDeposit;
  isUpdatingStatus: boolean;
  isCrediting: boolean;
  isAnyActionRunning: boolean;
  onUpdateStatus: (id: string, status: AdminDepositStatus) => Promise<void>;
  onCredit: (id: string) => Promise<void>;
}) {
  const canMarkVerified = deposit.status === 'PENDING' || deposit.status === 'CONFIRMING';
  const canMarkFailed = deposit.status !== 'FAILED' && deposit.status !== 'COMPLETED';
  const canCredit = deposit.status === 'VERIFIED';

  return (
    <tr className="align-top transition-colors hover:bg-[#F8FAFC]">
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-mono font-bold">{deposit.id.slice(0, 8)}...</p>
        <p className="mt-1 text-[10px] text-[#667085]">User: {deposit.userId.slice(0, 8)}...</p>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-semibold">#{deposit.chainId}</td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-bold">{formatTokenAmount(deposit.tdxAmount)}</p>
        <p className="mt-1 text-[10px] text-[#667085]">{formatTokenAmount(deposit.usdtAmount, 'USDT')}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={DEPOSIT_STATUS_BADGE_VARIANTS[deposit.status]}>{formatDepositStatus(deposit.status)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-semibold">
        {deposit.confirmations}/{deposit.requiredConfirmations}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <div className="flex flex-wrap items-center gap-2">
          {canMarkVerified && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isUpdatingStatus}
              disabled={isAnyActionRunning || isCrediting}
              onClick={() => void onUpdateStatus(deposit.id, 'VERIFIED')}
            >
              Mark Verified
            </Button>
          )}
          {canCredit && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isCrediting}
              disabled={isAnyActionRunning || isUpdatingStatus}
              onClick={() => void onCredit(deposit.id)}
            >
              Credit
            </Button>
          )}
          {canMarkFailed && (
            <Button
              variant="danger"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isUpdatingStatus && !canCredit}
              disabled={isAnyActionRunning || isCrediting}
              onClick={() => void onUpdateStatus(deposit.id, 'FAILED')}
            >
              Mark Failed
            </Button>
          )}
          {!canMarkVerified && !canCredit && !canMarkFailed && (
            <span className="text-[#98A2B3]">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] cursor-help">{formatRelativeTime(deposit.createdAt)}</td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">{formatAddress(deposit.transactionHash)}</td>
    </tr>
  );
}

export default function AdminDepositsScreen() {
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminDepositFilterStatus>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [pendingCreditId, setPendingCreditId] = useState<string | null>(null);

  const loadDeposits = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      // ✅ FIX: Use getAdminDeposits (all deposits) instead of getAdminPendingDeposits
      const result = await AdminService.getAdminDeposits({
        limit,
        offset,
        status: status === 'ALL' ? undefined : status,
        search: search || undefined,
      });

      setDeposits(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setDeposits([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, search, status]);

  useEffect(() => {
    void loadDeposits({ withLoader: true });
  }, [loadDeposits]);

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
  }, []);

  const handleUpdateStatus = useCallback(async (depositId: string, newStatus: AdminDepositStatus) => {
    if (pendingStatusId || pendingCreditId) return;
    setPendingStatusId(depositId);
    try {
      await AdminService.updateDepositStatus(depositId, newStatus);
      await loadDeposits({ withLoader: false });
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
    } finally {
      setPendingStatusId(null);
    }
  }, [pendingStatusId, pendingCreditId, loadDeposits]);

  const handleCredit = useCallback(async (depositId: string) => {
    if (pendingStatusId || pendingCreditId) return;
    setPendingCreditId(depositId);
    try {
      await AdminService.creditDeposit(depositId);
      await loadDeposits({ withLoader: false });
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
    } finally {
      setPendingCreditId(null);
    }
  }, [pendingStatusId, pendingCreditId, loadDeposits]);

  const isAnyActionRunning = Boolean(pendingStatusId || pendingCreditId);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + deposits.length, total);

  return (
    <div className="space-y-3">
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Deposits</h1>
            <p className="mt-0.5 text-xs text-[#667085]">
              Review deposits, verify confirmations, and credit eligible transactions
            </p>
            {total > 0 && (
              <p className="mt-1 text-xs font-semibold text-[#111827]">
                Total: {total} deposit{total === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" loading={refreshing} onClick={() => void loadDeposits({ withLoader: false })}>
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </section>

      <DepositsFilters
        searchInput={searchInput}
        status={status}
        limit={limit}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={applySearch}
        onStatusChange={(val) => { setStatus(val); setOffset(0); }}
        onLimitChange={(val) => { setLimit(val); setOffset(0); }}
        onReset={resetFilters}
      />

      {loading && !deposits.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`deposit-skeleton-${i}`} className="grid grid-cols-8 gap-2">
                {Array.from({ length: 8 }).map((__, j) => (
                  <Skeleton key={`deposit-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && error && (
        <ErrorState title="Unable to load deposits" description={error} onRetry={() => void loadDeposits({ withLoader: true })} />
      )}

      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {deposits.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F9FAFB]">
                <Search size={24} className="text-[#98A2B3]" />
              </div>
              <p className="text-base font-bold text-[#344054]">No deposits found</p>
              <p className="mt-1 text-xs text-[#667085]">
                {status !== 'ALL' ? `Try changing status filter or` : 'Try'} changing search text or pagination options.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1080px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">ID / User</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Chain</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Amount</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Confirmations</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Actions</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {deposits.map((deposit) => (
                      <DepositTableRow
                        key={deposit.id}
                        deposit={deposit}
                        isUpdatingStatus={pendingStatusId === deposit.id}
                        isCrediting={pendingCreditId === deposit.id}
                        isAnyActionRunning={isAnyActionRunning}
                        onUpdateStatus={handleUpdateStatus}
                        onCredit={handleCredit}
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
                    <span className="mr-1">←</span> Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#344054]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button variant="secondary" size="sm" className="h-8 px-2.5 text-xs" disabled={!canGoNext} onClick={() => setOffset(offset + limit)}>
                    Next <span className="ml-1">→</span>
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