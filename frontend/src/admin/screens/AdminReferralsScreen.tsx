// frontend/src/admin/screens/AdminReferralsScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Search,
  Eye,
  Users,
  Wallet,
  TrendingDown,
  TrendingUp,
  Award,
  UserPlus,
  DollarSign,
  X,
} from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type { AdminReferral } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

// ============================================================
// HELPERS
// ============================================================

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

function formatBalance(value?: string): string {
  if (!value) return '0.00';
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function getLevelBadge(level: number): string {
  const colors: Record<number, string> = {
    1: 'bg-green-100 text-green-700 border-green-200',
    2: 'bg-blue-100 text-blue-700 border-blue-200',
    3: 'bg-purple-100 text-purple-700 border-purple-200',
    4: 'bg-orange-100 text-orange-700 border-orange-200',
    5: 'bg-red-100 text-red-700 border-red-200',
    6: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return colors[level] || colors[6];
}

// ============================================================
// TYPES
// ============================================================

interface ReferralDetailData {
  referral: {
    id: string;
    walletAddress: string;
    referralCode: string | null;
    referredBy: string | null;
    referrerWalletAddress: string | null;
    directReferralsCount: number;
    createdAt: string;
    updatedAt: string;
  };
  levels: Array<{
    level: number;
    percentage: string;
    users: number;
    earnings: string;
    activeUsers: number;
  }>;
  totalReferrals: number;
  totalEarnings: string;
  totalNetworkDeposits: string;
  totalNetworkWithdrawals: string;
  directReferrals: number;
  indirectReferrals: number;
  joinedAt: string;
}

// ============================================================
// REFERRAL DETAIL MODAL
// ============================================================

function ReferralDetailModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ReferralDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await AdminService.getAdminReferralDetails(userId);
        setData(result);
      } catch (err) {
        setError(AdminService.getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [userId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
        <div className="w-full max-w-4xl rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-xl">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 bg-[#EAECF0] rounded animate-pulse w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
        <div className="w-full max-w-md rounded-[16px] border border-red-200 bg-red-50 p-6 shadow-xl text-center">
          <p className="font-bold text-red-600">Error loading referral details</p>
          <p className="mt-2 text-sm text-[#667085]">{error || 'Unknown error'}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const { referral, levels, totalReferrals, totalEarnings, totalNetworkDeposits, totalNetworkWithdrawals, directReferrals, indirectReferrals } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-[#111827]">Referral Details</h2>
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={onClose}>
            <X size={14} className="mr-1" /> Close
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Wallet</p>
            <p className="mt-0.5 font-mono font-semibold text-[#111827]">{referral.walletAddress}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Referral Code</p>
            <p className="mt-0.5 font-bold text-[#111827]">{referral.referralCode || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Referred By</p>
            <p className="mt-0.5 font-mono text-[#111827]">{referral.referredBy || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Joined</p>
            <p className="mt-0.5 font-semibold text-[#111827]">{formatDateTime(referral.createdAt)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-[#EAECF0] bg-gradient-to-br from-green-50 to-white p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-green-600">
              <UserPlus size={14} />
              <p className="text-[10px] font-bold text-[#667085]">Total Referrals</p>
            </div>
            <p className="text-xl font-black text-[#111827]">{totalReferrals}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-gradient-to-br from-blue-50 to-white p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-blue-600">
              <DollarSign size={14} />
              <p className="text-[10px] font-bold text-[#667085]">Total Earnings</p>
            </div>
            <p className="text-xl font-black text-[#111827]">{formatBalance(totalEarnings)} TDX</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-gradient-to-br from-purple-50 to-white p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-600">
              <TrendingDown size={14} />
              <p className="text-[10px] font-bold text-[#667085]">Network Deposits</p>
            </div>
            <p className="text-xl font-black text-[#111827]">{formatBalance(totalNetworkDeposits)} TDX</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-gradient-to-br from-red-50 to-white p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-red-600">
              <TrendingUp size={14} />
              <p className="text-[10px] font-bold text-[#667085]">Network Withdrawals</p>
            </div>
            <p className="text-xl font-black text-[#111827]">{formatBalance(totalNetworkWithdrawals)} TDX</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Direct Referrals</p>
            <p className="text-2xl font-black text-green-600">{directReferrals}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Indirect Referrals</p>
            <p className="text-2xl font-black text-blue-600">{indirectReferrals}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-[#667085]" />
            <p className="text-sm font-black text-[#111827]">Level Breakdown (L1-L6)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#EAECF0] bg-[#F9FAFB]">
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#667085]">Level</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#667085]">Percentage</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#667085]">Users</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#667085]">Active</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[#667085]">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((level) => (
                  <tr key={level.level} className="border-b border-[#F2F4F7]">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center justify-center h-6 min-w-[24px] rounded-full bg-[#F9FAFB] border border-[#E5E7EB] text-[10px] font-bold">
                        L{level.level}
                      </span>
                    </td>
                    <td className="px-3 py-2">{level.percentage}</td>
                    <td className="px-3 py-2 font-bold">{level.users}</td>
                    <td className="px-3 py-2">{level.activeUsers}</td>
                    <td className="px-3 py-2 font-semibold text-green-600">{formatBalance(level.earnings)} TDX</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// FILTERS COMPONENT
// ============================================================

function ReferralsFilters({
  searchInput,
  limit,
  onSearchInputChange,
  onSearchSubmit,
  onLimitChange,
  onReset,
}: {
  searchInput: string;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onLimitChange: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
          <input
            type="text"
            placeholder="Search by wallet or referral code"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 py-2 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
          />
        </div>

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
          <Button type="submit" variant="secondary" size="sm" className="h-9 px-3 text-xs" onClick={onSearchSubmit}>
            Search
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 px-3 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>
      </form>
    </section>
  );
}

// ============================================================
// ✅ TABLE ROW - DEFINED BEFORE MAIN COMPONENT
// ============================================================

function ReferralTableRow({
  referral,
  onView,
}: {
  referral: AdminReferral;
  onView: (referral: AdminReferral) => void;
}) {
  return (
    <tr className="align-top transition-colors hover:bg-[#F8FAFC]">
      <td className="px-3 py-2 text-xs text-[#111827] font-mono font-bold">
        {referral.id.slice(0, 10)}...
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">
        {formatAddress(referral.walletAddress)}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-semibold">
        {referral.referralCode || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <div className="space-y-0.5">
          <p className="font-mono">{referral.referredBy || '—'}</p>
          <p className="text-[10px] text-[#667085]">
            Wallet: {referral.referrerWalletAddress ? formatAddress(referral.referrerWalletAddress) : '—'}
          </p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-bold">
        {referral.directReferralsCount}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] cursor-help">
        {formatRelativeTime(referral.createdAt)}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => onView(referral)}
        >
          <Eye size={12} className="mr-1" />
          View
        </Button>
      </td>
    </tr>
  );
}

// ============================================================
// ✅ MAIN COMPONENT - DEFINED LAST
// ============================================================

export default function AdminReferralsScreen() {
  const [referrals, setReferrals] = useState<AdminReferral[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState<AdminReferral | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const loadReferrals = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await AdminService.getAdminReferrals({ limit, offset, search });
      setReferrals(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setReferrals([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, search]);

  useEffect(() => {
    void loadReferrals({ withLoader: true });
  }, [loadReferrals]);

  const applySearch = useCallback(() => {
    setSearch(searchInput.trim());
    setOffset(0);
  }, [searchInput]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setLimit(20);
    setOffset(0);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + referrals.length, total);

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Referrals</h1>
            <p className="mt-0.5 text-xs text-[#667085]">
              Review referral network with level-wise tracking (1-6 levels)
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadReferrals({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </section>

      {/* Filters */}
      <ReferralsFilters
        searchInput={searchInput}
        limit={limit}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={applySearch}
        onLimitChange={(val) => { setLimit(val); setOffset(0); }}
        onReset={resetFilters}
      />

      {/* Loading */}
      {loading && !referrals.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`ref-skeleton-${i}`} className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }).map((__, j) => (
                  <Skeleton key={`ref-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState
          title="Unable to load referrals"
          description={error}
          onRetry={() => void loadReferrals({ withLoader: true })}
        />
      )}

      {/* Table */}
      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {referrals.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F9FAFB]">
                <Users size={24} className="text-[#98A2B3]" />
              </div>
              <p className="text-base font-bold text-[#344054]">No referrals found</p>
              <p className="mt-1 text-xs text-[#667085]">Try changing search text or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1120px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">ID</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Code</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Referrer</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Direct</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {referrals.map((referral) => (
                      <ReferralTableRow
                        key={referral.id}
                        referral={referral}
                        onView={setSelectedReferral}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EAECF0] px-3 py-2.5">
                <p className="text-xs text-[#667085]">
                  Showing <span className="font-bold text-[#111827]">{rangeStart}-{rangeEnd}</span> of{' '}
                  <span className="font-bold text-[#111827]">{total}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canGoPrev}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs font-semibold text-[#344054]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canGoNext}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* Referral Detail Modal */}
      {selectedReferral && (
        <ReferralDetailModal
          userId={selectedReferral.id}
          onClose={() => setSelectedReferral(null)}
        />
      )}
    </div>
  );
}