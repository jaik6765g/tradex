// frontend/src/admin/screens/AdminUsersScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, Eye, X, TrendingUp, TrendingDown, Wallet, History, Gift } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type {
  AdminBonusHistoryItem,
  AdminUser,
  AdminUserFilterStatus,
  AdminUserStatus,
} from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

interface UserDetailData {
  user: {
    id: string;
    walletAddress: string;
    status: string;
    referralCode: string | null;
    referredBy: string | null;
    referrerWalletAddress: string | null;
    createdAt: string;
    updatedAt: string;
  };
  balance: {
    availableBalance: string;
    lockedBalance: string;
    totalBalance: string;
  } | null;
  stats: {
    deposits: string;
    withdrawals: string;
    totalTrades: number;
    totalTradeVolume: string;
    totalProfit: string;
    totalLoss: string;
  };
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

const USER_STATUS_OPTIONS: Array<{ label: string; value: AdminUserFilterStatus }> = [
  { label: 'All Statuses', value: 'ALL' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Blocked', value: 'blocked' },
];

const USER_STATUS_BADGE_VARIANTS: Record<
  AdminUserStatus,
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  active: 'success',
  inactive: 'warning',
  blocked: 'error',
};

// ============================================================
// FORMAT HELPERS
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
  if (!value) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokenAmount(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getUserStatusBadgeVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'active' || normalized === 'inactive' || normalized === 'blocked') {
    return USER_STATUS_BADGE_VARIANTS[normalized as AdminUserStatus];
  }
  return 'neutral';
}

function formatUserStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ============================================================
// FILTERS COMPONENT
// ============================================================

function UsersFilters({
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
  status: AdminUserFilterStatus;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: AdminUserFilterStatus) => void;
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
            placeholder="Search by user ID, wallet, or referral"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 py-2 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminUserFilterStatus)}
          className="rounded-[10px] border border-[#D0D5DD] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
        >
          {USER_STATUS_OPTIONS.map((option) => (
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

// ============================================================
// TABLE ROW - FIXED
// ============================================================

function UserTableRow({
  user,
  onView,
}: {
  user: AdminUser;
  onView: (user: AdminUser) => void;
}) {
  return (
    <tr className="align-top transition-colors hover:bg-[#F8FAFC]">
      <td className="px-3 py-2 text-xs text-[#111827] font-mono font-bold">
        {user.id.slice(0, 10)}...
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">
        {formatAddress(user.walletAddress)}
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getUserStatusBadgeVariant(user.status)}>
          {formatUserStatus(user.status)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <div className="space-y-0.5">
          <p className="font-semibold">{user.referralCode || '—'}</p>
          <p className="text-[10px] text-[#667085]">Referrer: {user.referredBy || '—'}</p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        {user.balance ? (
          <div className="space-y-0.5">
            <p><span className="text-[#667085]">Available:</span> <span className="font-semibold">{formatBalance(user.balance.availableBalance)}</span></p>
            <p><span className="text-[#667085]">Locked:</span> <span className="font-semibold">{formatBalance(user.balance.lockedBalance)}</span></p>
            <p><span className="text-[#667085]">Total:</span> <span className="font-bold">{formatBalance(user.balance.totalBalance)}</span></p>
          </div>
        ) : <span className="text-[#98A2B3]">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <span className="cursor-help">{formatRelativeTime(user.createdAt)}</span>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => onView(user)}
        >
          <Eye size={12} className="mr-1" />
          View
        </Button>
      </td>
    </tr>
  );
}

// ============================================================
// BONUS DISTRIBUTION SECTION
// ============================================================

const ADMIN_BONUS_MAX = 10000;

function BonusDistributionSection({
  userId,
  onDistributed,
}: {
  userId: string;
  onDistributed: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<AdminBonusHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const result = await AdminService.getBonusHistory({ userId, limit: 10 });
      setHistory(result.items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const parsedAmount = Number(amount);
  const amountValid =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= ADMIN_BONUS_MAX;
  const descriptionValid = description.trim().length >= 3;
  const canDistribute = amountValid && descriptionValid && !distributing;

  const handleDistribute = async () => {
    if (!canDistribute) return;
    setDistributing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await AdminService.distributeBonus({
        userId,
        amount: parsedAmount,
        description: description.trim(),
        idempotencyKey: `bonus-${userId.slice(0, 8)}-${Date.now()}`,
      });

      const result = response.data;
      setSuccess(
        result.replayed
          ? 'Bonus was already distributed for this request (no double credit).'
          : `Bonus of ${formatTokenAmount(result.amount)} TDX distributed — new available balance: ${formatTokenAmount(result.availableBalanceAfter)} TDX`,
      );
      setAmount('');
      setDescription('');
      setConfirming(false);
      setShowForm(false);
      onDistributed();
      void loadHistory();
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
    } finally {
      setDistributing(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">
          Bonus Distribution
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-[11px]"
          onClick={() => setShowForm((v) => !v)}
        >
          <Gift size={12} className="mr-1" />
          {showForm ? 'Hide' : 'Distribute Bonus'}
        </Button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-2 rounded-lg bg-green-50 px-2 py-1.5 text-[11px] font-semibold text-green-700">
          ✓ {success}
        </p>
      )}

      {showForm && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="text-[10px] font-bold text-[#344054]">
              Amount (TDX, max {ADMIN_BONUS_MAX.toLocaleString()})
            </label>
            <input
              type="number"
              min="0.01"
              max={ADMIN_BONUS_MAX}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              className="mt-1 w-full rounded-lg border border-[#D0D5DD] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#7F56D9]"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#344054]">
              Reason / Description (required)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why is this bonus being granted?"
              rows={2}
              maxLength={500}
              className="mt-1 w-full resize-none rounded-lg border border-[#D0D5DD] bg-white px-2 py-1.5 text-xs text-[#111827] outline-none focus:border-[#7F56D9]"
            />
            <p className="mt-0.5 text-right text-[10px] text-[#98A2B3]">
              {description.trim().length}/500
            </p>
          </div>
          {!confirming ? (
            <Button
              variant="primary"
              size="sm"
              className="h-8 w-full text-xs"
              disabled={!canDistribute}
              loading={distributing}
              onClick={() => setConfirming(true)}
            >
              Distribute Bonus
            </Button>
          ) : (
            <div className="rounded-lg border border-[#FEF0C7] bg-[#FFFAEB] p-2">
              <p className="text-[11px] font-bold text-[#344054]">
                Confirm: distribute {formatTokenAmount(amount || '0')} TDX to this user?
              </p>
              <p className="mt-0.5 text-[10px] text-[#667085]">
                Reason: {description.trim() || '—'}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 flex-1 text-[11px]"
                  loading={distributing}
                  onClick={() => void handleDistribute()}
                >
                  Confirm &amp; Distribute
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 flex-1 text-[11px]"
                  disabled={distributing}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bonus history with reasons */}
      <div className="mt-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">
          Recent Bonuses
        </p>
        {historyLoading ? (
          <div className="mt-2 space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : history.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-[#98A2B3]">
            No bonuses distributed to this user yet.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-white px-2 py-1.5 border border-[#EAECF0]"
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-normal break-words text-[11px] font-semibold text-[#111827]">
                    {item.description}
                  </p>
                  <p className="text-[10px] text-[#667085]">
                    {formatRelativeTime(item.createdAt)}
                    {item.adminEmail ? ` · by ${item.adminEmail}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-bold text-green-600">
                  +{formatTokenAmount(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================
// USER DETAIL MODAL
// ============================================================

function UserDetailModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<UserDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await AdminService.getAdminUserDetails(userId);
        setData(result);
      } catch (err) {
        setError(AdminService.getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [userId, reloadKey]);

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
          <p className="font-bold text-red-600">Error loading user details</p>
          <p className="mt-2 text-sm text-[#667085]">{error || 'Unknown error'}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const { user, balance, stats } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-[16px] border border-[#E5E7EB] bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-[#111827]">User Details</h2>
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={onClose}>
            <X size={14} className="mr-1" /> Close
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 text-xs text-[#344054] sm:grid-cols-2">
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">User ID</p>
            <p className="mt-0.5 font-mono font-semibold text-[#111827]">{user.id}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Wallet Address</p>
            <p className="mt-0.5 font-mono font-semibold text-[#111827]">{user.walletAddress}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Status</p>
            <div className="mt-0.5">
              <Badge variant={getUserStatusBadgeVariant(user.status)}>
                {formatUserStatus(user.status)}
              </Badge>
            </div>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Created At</p>
            <p className="mt-0.5 font-semibold text-[#111827]">{formatDateTime(user.createdAt)}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Referral Code</p>
            <p className="mt-0.5 font-bold text-[#111827]">{user.referralCode || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Referred By</p>
            <p className="mt-0.5 font-mono text-[#111827]">{user.referredBy ? formatAddress(user.referredBy) : '—'}</p>
          </div>
        </div>

        {balance && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">TDX Balance</p>
            <div className="mt-2 flex gap-2">
              <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0] flex-1">
                <p className="text-[#667085]">Available</p>
                <p className="text-base font-bold text-green-600">{formatBalance(balance.availableBalance)} TDX</p>
              </div>
              <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0] flex-1">
                <p className="text-[#667085]">Locked</p>
                <p className="text-base font-bold text-yellow-600">{formatBalance(balance.lockedBalance)} TDX</p>
              </div>
              <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0] flex-1">
                <p className="text-[#667085]">Total</p>
                <p className="text-base font-bold text-[#111827]">{formatBalance(balance.totalBalance)} TDX</p>
              </div>
            </div>
          </div>
        )}

        <BonusDistributionSection
          userId={userId}
          onDistributed={() => setReloadKey((k) => k + 1)}
        />

        <div className="mt-4 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Financial Summary</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <div className="flex items-center justify-center gap-1 text-green-600">
                <TrendingDown size={14} />
                <p className="text-[#667085] text-[10px]">Deposits</p>
              </div>
              <p className="text-base font-bold text-[#111827]">{formatBalance(stats.deposits)} TDX</p>
            </div>
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <div className="flex items-center justify-center gap-1 text-red-600">
                <TrendingUp size={14} />
                <p className="text-[#667085] text-[10px]">Withdrawals</p>
              </div>
              <p className="text-base font-bold text-[#111827]">{formatBalance(stats.withdrawals)} TDX</p>
            </div>
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <div className="flex items-center justify-center gap-1 text-blue-600">
                <Wallet size={14} />
                <p className="text-[#667085] text-[10px]">Net Flow</p>
              </div>
              <p className={`text-base font-bold ${parseFloat(stats.deposits) - parseFloat(stats.withdrawals) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {(parseFloat(stats.deposits) - parseFloat(stats.withdrawals)).toFixed(2)} TDX
              </p>
            </div>
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <div className="flex items-center justify-center gap-1 text-purple-600">
                <History size={14} />
                <p className="text-[#667085] text-[10px]">Total Trades</p>
              </div>
              <p className="text-base font-bold text-[#111827]">{stats.totalTrades}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Trade Statistics</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 text-xs">
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <p className="text-[#667085]">Total Volume</p>
              <p className="text-base font-bold text-[#111827]">{formatBalance(stats.totalTradeVolume)} TDX</p>
            </div>
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <p className="text-[#667085]">Total Profit</p>
              <p className="text-base font-bold text-green-600">{formatBalance(stats.totalProfit)} TDX</p>
            </div>
            <div className="rounded-lg bg-white p-2 text-center border border-[#EAECF0]">
              <p className="text-[#667085]">Total Loss</p>
              <p className="text-base font-bold text-red-600">{formatBalance(stats.totalLoss)} TDX</p>
            </div>
          </div>
        </div>

        {user.referrerWalletAddress && (
          <div className="mt-4 rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]">Referrer</p>
            <p className="mt-1 font-mono text-[#111827]">{user.referrerWalletAddress}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ✅ MAIN COMPONENT - FIXED
// ============================================================

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminUserFilterStatus>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const loadUsers = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await AdminService.getAdminUsers({
        limit,
        offset,
        status,
        search,
      });
      setUsers(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setUsers([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, status, search]);

  useEffect(() => {
    void loadUsers({ withLoader: true });
  }, [loadUsers]);

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

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + users.length, total);

  return (
    <div className="space-y-3">
      {/* Header */}
      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Users</h1>
            <p className="mt-0.5 text-xs text-[#667085]">Manage platform users and account status</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-3 text-xs"
            loading={refreshing}
            onClick={() => void loadUsers({ withLoader: false })}
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
        </div>
      </section>

      {/* Filters */}
      <UsersFilters
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
      {loading && !users.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`user-skeleton-${i}`} className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }).map((__, j) => (
                  <Skeleton key={`user-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="Unable to load users" description={error} onRetry={() => void loadUsers({ withLoader: true })} />
      )}

      {/* Table */}
      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {users.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#344054]">No users found</p>
              <p className="mt-1 text-xs text-[#667085]">Try changing status, search text, or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">ID</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Referral</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Balance</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {users.map((user) => (
                      <UserTableRow 
                        key={user.id} 
                        user={user} 
                        onView={(user) => setSelectedUserId(user.id)}  // ✅ FIXED: Extract id
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

      {/* User Detail Modal */}
      {selectedUserId && (
        <UserDetailModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}