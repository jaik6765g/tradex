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
  { label: 'Below Minimum', value: 'BELOW_MINIMUM' },
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
  BELOW_MINIMUM: 'neutral',
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
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#70737E]" />
          <input
            type="text"
            placeholder="Search by deposit ID, user ID, tx hash, or chain"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#34343E] bg-[#15161C] pl-9 pr-3 py-2 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminDepositFilterStatus)}
          className="rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
        >
          {DEPOSIT_STATUS_OPTIONS.map((option) => (
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

function DepositTableRow({
  deposit,
  isUpdatingStatus,
  isCrediting,
  isAnyActionRunning,
  onUpdateStatus,
  onCredit,
  onReview,
}: {
  deposit: AdminDeposit;
  isUpdatingStatus: boolean;
  isCrediting: boolean;
  isAnyActionRunning: boolean;
  onUpdateStatus: (id: string, status: AdminDepositStatus) => Promise<void>;
  onCredit: (id: string) => Promise<void>;
  onReview: (deposit: AdminDeposit) => void;
}) {
  const canMarkVerified = deposit.status === 'PENDING' || deposit.status === 'CONFIRMING';
  const canMarkFailed = deposit.status !== 'FAILED' && deposit.status !== 'COMPLETED';
  const canCredit = deposit.status === 'VERIFIED';
  const canReview = deposit.status === 'BELOW_MINIMUM';

  return (
    <tr className="align-top transition-colors hover:bg-[#111217]">
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-mono font-bold">{deposit.id.slice(0, 8)}...</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">User: {deposit.userId.slice(0, 8)}...</p>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-semibold">#{deposit.chainId}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <p className="font-bold">{formatTokenAmount(deposit.tdxAmount)}</p>
        <p className="mt-1 text-[10px] text-[#A1A4AE]">{formatTokenAmount(deposit.usdtAmount, 'USDT')}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={DEPOSIT_STATUS_BADGE_VARIANTS[deposit.status]}>{formatDepositStatus(deposit.status)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-semibold">
        {deposit.confirmations}/{deposit.requiredConfirmations}
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
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
          {canReview && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={isAnyActionRunning}
              onClick={() => onReview(deposit)}
            >
              Review
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
          {!canMarkVerified && !canCredit && !canMarkFailed && !canReview && (
            <span className="text-[#70737E]">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] cursor-help">{formatRelativeTime(deposit.createdAt)}</td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-mono">{formatAddress(deposit.transactionHash)}</td>
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

  // Below-minimum review (Architecture Plan v3): mandatory reason, atomic
  // CREDIT (detection-time rate) or REJECT, audited server-side.
  const [reviewing, setReviewing] = useState<{
    deposit: AdminDeposit;
    decision: 'CREDIT' | 'REJECT';
    reason: string;
  } | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);

  const handleReviewSubmit = useCallback(async () => {
    if (!reviewing) return;
    const reason = reviewing.reason.trim();
    if (!reason) {
      setError('A reason is required for every below-minimum review decision');
      return;
    }
    setReviewSaving(true);
    try {
      await AdminService.reviewBelowMinimumDeposit(reviewing.deposit.id, {
        decision: reviewing.decision,
        reason,
      });
      setReviewing(null);
      await loadDeposits({ withLoader: false });
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
    } finally {
      setReviewSaving(false);
    }
  }, [reviewing, loadDeposits]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + deposits.length, total);

  return (
    <div className="space-y-3">
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Deposits</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">
              Review deposits, verify confirmations, and credit eligible transactions
            </p>
            {total > 0 && (
              <p className="mt-1 text-xs font-semibold text-[#F5F5F7]">
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
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
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
        <section className="overflow-hidden rounded-[16px] border border-[#292B33] bg-[#15161C]">
          {deposits.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#15161C]">
                <Search size={24} className="text-[#70737E]" />
              </div>
              <p className="text-base font-bold text-[#E4E5E8]">No deposits found</p>
              <p className="mt-1 text-xs text-[#A1A4AE]">
                {status !== 'ALL' ? `Try changing status filter or` : 'Try'} changing search text or pagination options.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1080px] w-full divide-y divide-[#202229]">
                  <thead className="bg-[#15161C]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">ID / User</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Chain</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Amount</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Confirmations</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Actions</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1B1917] bg-[#15161C]">
                    {deposits.map((deposit) => (
                      <DepositTableRow
                        key={deposit.id}
                        deposit={deposit}
                        isUpdatingStatus={pendingStatusId === deposit.id}
                        isCrediting={pendingCreditId === deposit.id}
                        isAnyActionRunning={isAnyActionRunning}
                        onUpdateStatus={handleUpdateStatus}
                        onCredit={handleCredit}
                        onReview={(deposit) => setReviewing({ deposit, decision: 'CREDIT', reason: '' })}
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
                    <span className="mr-1">←</span> Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#E4E5E8]">
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

      {/* Below-Minimum Review Modal */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
          <div className="w-full max-w-lg rounded-[16px] border border-[#292B33] bg-[#15161C] p-4 shadow-xl">
            <h2 className="text-base font-black text-[#F5F5F7]">Review Below-Minimum Deposit</h2>
            <p className="mt-2 text-xs text-[#A1A4AE]">
              Detected amount <span className="font-bold text-[#F5F5F7]">{formatTokenAmount(reviewing.deposit.usdtAmount, 'USDT')}</span> is
              below the configured minimum. It was recorded but never auto-credited.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReviewing((prev) => (prev ? { ...prev, decision: 'CREDIT' } : prev))}
                className={`rounded-[10px] border px-3 py-2 text-xs font-bold ${reviewing.decision === 'CREDIT' ? 'border-[#1E4A32] bg-[#10251A] text-[#4ADE80]' : 'border-[#34343E] bg-[#15161C] text-[#A1A4AE]'}`}
              >
                CREDIT (detection-time rate)
              </button>
              <button
                type="button"
                onClick={() => setReviewing((prev) => (prev ? { ...prev, decision: 'REJECT' } : prev))}
                className={`rounded-[10px] border px-3 py-2 text-xs font-bold ${reviewing.decision === 'REJECT' ? 'border-[#4A2323] bg-[#281313] text-[#F87171]' : 'border-[#34343E] bg-[#15161C] text-[#A1A4AE]'}`}
              >
                REJECT (no credit)
              </button>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">
                Reason <span className="text-[#F87171]">*</span>
              </label>
              <textarea
                value={reviewing.reason}
                onChange={(e) => setReviewing((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
                placeholder="Mandatory — recorded in the immutable audit log"
                className="min-h-[72px] w-full rounded-[10px] border border-[#34343E] bg-[#15161C] p-2.5 text-xs text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" disabled={reviewSaving} onClick={() => setReviewing(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 px-3 text-xs"
                loading={reviewSaving}
                disabled={!reviewing.reason.trim()}
                onClick={() => void handleReviewSubmit()}
              >
                {reviewing.decision === 'CREDIT' ? 'Confirm Credit' : 'Confirm Reject'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}