// frontend/src/admin/screens/AdminUsersScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, Eye, X, TrendingUp, TrendingDown, Wallet, History, Gift } from 'lucide-react';

import { AdminService } from '../services/admin.service';
import type {
  AdminBonusCategory,
  AdminBonusHistoryItem,
  AdminBonusWageringMultiplierMode,
  AdminUser,
  AdminUserFilterStatus,
  AdminUserStatus,
} from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';

interface UserDetailData {
  user: {
    id: string;
    walletAddress: string | null;
    mobileNumber: string | null;
    email: string | null;
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

function formatAddress(address?: string | null): string {
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
    <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-3">
      <form
        className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_180px_140px_auto]"
        onSubmit={(e) => { e.preventDefault(); onSearchSubmit(); }}
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#70737E]" />
          <input
            type="text"
            placeholder="Search by user ID, wallet, mobile, email, or referral"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#34343E] bg-[#15161C] pl-9 pr-3 py-2 text-sm text-[#F5F5F7] placeholder:text-[#70737E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminUserFilterStatus)}
          className="rounded-[10px] border border-[#34343E] bg-[#15161C] px-3 py-2 text-sm font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A18]"
        >
          {USER_STATUS_OPTIONS.map((option) => (
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
    <tr className="align-top transition-colors hover:bg-[#111217]">
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-mono font-bold">
        {user.id.slice(0, 10)}...
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7] font-mono">
        {formatAddress(user.walletAddress)}
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <div className="space-y-0.5">
          <p className="font-semibold">{user.mobileNumber || '—'}</p>
          <p className="max-w-[180px] truncate text-[10px] text-[#A1A4AE]" title={user.email || ''}>
            {user.email || '—'}
          </p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={getUserStatusBadgeVariant(user.status)}>
          {formatUserStatus(user.status)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <div className="space-y-0.5">
          <p className="font-semibold">{user.referralCode || '—'}</p>
          <p className="text-[10px] text-[#A1A4AE]">Referrer: {user.referredBy || '—'}</p>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        {user.balance ? (
          <div className="space-y-0.5">
            <p><span className="text-[#A1A4AE]">Available:</span> <span className="font-semibold">{formatBalance(user.balance.availableBalance)}</span></p>
            <p><span className="text-[#A1A4AE]">Locked:</span> <span className="font-semibold">{formatBalance(user.balance.lockedBalance)}</span></p>
            <p><span className="text-[#A1A4AE]">Total:</span> <span className="font-bold">{formatBalance(user.balance.totalBalance)}</span></p>
          </div>
        ) : <span className="text-[#70737E]">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
        <span className="cursor-help">{formatRelativeTime(user.createdAt)}</span>
      </td>
      <td className="px-3 py-2 text-xs text-[#F5F5F7]">
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

/** Max CUSTOM wagering multiplier — mirrors the backend cap exactly. */
const MAX_CUSTOM_WAGERING_MULTIPLIER = 100;

const BONUS_CATEGORY_OPTIONS: { value: AdminBonusCategory; label: string }[] = [
  { value: 'MANUAL_BONUS', label: 'Manual Bonus' },
  { value: 'DEPOSIT_BONUS', label: 'Deposit Bonus' },
  { value: 'SALARY_BONUS', label: 'Salary Bonus' },
  { value: 'REFERRAL_BONUS', label: 'Referral Bonus (non-wagerable)' },
  { value: 'WELCOME_BONUS', label: 'Welcome Bonus' },
  { value: 'PROMOTIONAL_BONUS', label: 'Promotional Bonus' },
  { value: 'CASHBACK_BONUS', label: 'Cashback Bonus' },
];

const WAGERING_MULTIPLIER_MODES: AdminBonusWageringMultiplierMode[] = [
  '1X',
  '2X',
  '3X',
  'CUSTOM',
];

const SELECT_CLASS =
  'rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1.5 text-xs font-semibold text-[#F5F5F7] outline-none focus-visible:ring-2 focus-visible:ring-[#7F56D9]';

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
  // --- Bonus category + wagering control ---
  const [bonusCategory, setBonusCategory] =
    useState<AdminBonusCategory>('MANUAL_BONUS');
  const [wageringRequired, setWageringRequired] = useState(true);
  const [multiplierMode, setMultiplierMode] =
    useState<AdminBonusWageringMultiplierMode>('2X');
  const [customMultiplier, setCustomMultiplier] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
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

  const referralSelected = bonusCategory === 'REFERRAL_BONUS';
  // REFERRAL_BONUS is always non-wagerable — the toggle is forced to NO.
  const wagerEnabled = !referralSelected && wageringRequired;
  const selectedMultiplier =
    multiplierMode === 'CUSTOM' ? customMultiplier.trim() : multiplierMode.slice(0, 1);
  const customMultiplierValid =
    multiplierMode !== 'CUSTOM'
      ? true
      : /^\d+(\.\d+)?$/.test(customMultiplier.trim()) &&
        Number(customMultiplier) > 0 &&
        Number(customMultiplier) <= MAX_CUSTOM_WAGERING_MULTIPLIER;
  const expiryValid =
    expiresAt === '' || new Date(expiresAt).getTime() > Date.now();
  const canDistribute =
    amountValid &&
    descriptionValid &&
    (!wagerEnabled || customMultiplierValid) &&
    expiryValid &&
    !distributing;

  const formatMultiplierLabel = (value: string | null): string =>
    value === null || value === '' ? '' : String(Number(value));

  const wageringPreview =
    wagerEnabled && amountValid && customMultiplierValid
      ? Number(selectedMultiplier) * parsedAmount
      : null;

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
        bonusCategory,
        wageringRequired: wagerEnabled,
        ...(wagerEnabled ? { wageringMultiplier: selectedMultiplier } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });

      const result = response.data;
      const wageringNote = result.wageringRequired
        ? ` · wagering ${formatMultiplierLabel(result.wageringMultiplier)}X required`
        : ' · non-wagerable';
      setSuccess(
        result.replayed
          ? 'Bonus was already distributed for this request (no double credit).'
          : `Bonus of ${formatTokenAmount(result.amount)} TDX distributed${wageringNote} — new available balance: ${formatTokenAmount(result.availableBalanceAfter)} TDX`,
      );
      setAmount('');
      setDescription('');
      setCustomMultiplier('');
      setExpiresAt('');
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
    <div className="mt-4 rounded-xl border border-[#202229] bg-[#15161C] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">
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
        <p className="mt-2 rounded-lg bg-[#281313] px-2 py-1.5 text-[11px] font-semibold text-[#F87171]">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-2 rounded-lg bg-[#10251A] px-2 py-1.5 text-[11px] font-semibold text-[#6EE7B7]">
          ✓ {success}
        </p>
      )}

      {showForm && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="text-[10px] font-bold text-[#E4E5E8]">
              Bonus Category
            </label>
            <select
              value={bonusCategory}
              onChange={(e) => {
                const next = e.target.value as AdminBonusCategory;
                setBonusCategory(next);
                // REFERRAL_BONUS is non-wagerable: force the toggle to NO.
                if (next === 'REFERRAL_BONUS') setWageringRequired(false);
              }}
              className={`mt-1 w-full ${SELECT_CLASS}`}
            >
              {BONUS_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {referralSelected && (
              <p className="mt-1 rounded-lg bg-[#1B1C24] px-2 py-1.5 text-[10px] text-[#A1A4AE]">
                Referral Bonus is referral commission — always non-wagerable.
                Wagering is disabled for this category.
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#E4E5E8]">
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
              className="mt-1 w-full rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1.5 text-xs text-[#F5F5F7] outline-none focus:border-[#7F56D9]"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#E4E5E8]">
              Reason / Description (required)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why is this bonus being granted?"
              rows={2}
              maxLength={500}
              className="mt-1 w-full resize-none rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1.5 text-xs text-[#F5F5F7] outline-none focus:border-[#7F56D9]"
            />
            <p className="mt-0.5 text-right text-[10px] text-[#70737E]">
              {description.trim().length}/500
            </p>
          </div>

          {/* Wagering control — YES/NO, multiplier, optional expiry */}
          <div className="rounded-lg border border-[#202229] bg-[#15161C] p-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold text-[#E4E5E8]">
                Wagering Required
              </label>
              <select
                value={wagerEnabled ? 'YES' : 'NO'}
                disabled={referralSelected}
                onChange={(e) => setWageringRequired(e.target.value === 'YES')}
                className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <option value="NO">NO</option>
                <option value="YES">YES</option>
              </select>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <label className="text-[10px] font-bold text-[#E4E5E8]">
                Multiplier
              </label>
              <select
                value={multiplierMode}
                disabled={!wagerEnabled}
                onChange={(e) =>
                  setMultiplierMode(e.target.value as AdminBonusWageringMultiplierMode)
                }
                className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {WAGERING_MULTIPLIER_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
              {multiplierMode === 'CUSTOM' && (
                <input
                  type="number"
                  min="0.01"
                  max={MAX_CUSTOM_WAGERING_MULTIPLIER}
                  step="0.01"
                  value={customMultiplier}
                  disabled={!wagerEnabled}
                  onChange={(e) => setCustomMultiplier(e.target.value)}
                  placeholder="e.g. 1.5"
                  className="w-24 rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1.5 text-xs text-[#F5F5F7] outline-none focus:border-[#7F56D9] disabled:cursor-not-allowed disabled:opacity-50"
                />
              )}
            </div>
            {wagerEnabled && multiplierMode === 'CUSTOM' && !customMultiplierValid && (
              <p className="mt-1 text-[10px] font-semibold text-[#F87171]">
                Custom multiplier must be a positive decimal up to {MAX_CUSTOM_WAGERING_MULTIPLIER}.
              </p>
            )}

            <div className="mt-2">
              <label className="text-[10px] font-bold text-[#E4E5E8]">
                Expiry (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                disabled={!wagerEnabled}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1.5 text-xs text-[#F5F5F7] outline-none focus:border-[#7F56D9] disabled:cursor-not-allowed disabled:opacity-50"
              />
              {!expiryValid && (
                <p className="mt-1 text-[10px] font-semibold text-[#F87171]">
                  Expiry must be in the future.
                </p>
              )}
            </div>

            {wageringPreview !== null && (
              <p className="mt-1.5 rounded-lg bg-[#1B1733] px-2 py-1.5 text-[10px] font-semibold text-[#B7A5F7]">
                Wagering obligation preview: {selectedMultiplier}X ×{' '}
                {formatTokenAmount(String(parsedAmount))} ={' '}
                {formatTokenAmount(String(wageringPreview))} TDX to wager before
                the bonus is withdrawable.
              </p>
            )}
            {!wagerEnabled && (
              <p className="mt-1.5 text-[10px] text-[#A1A4AE]">
                No wagering obligation will be created — the bonus is
                immediately withdrawable.
              </p>
            )}
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
            <div className="rounded-lg border border-[#33220F] bg-[#2A190D] p-2">
              <p className="text-[11px] font-bold text-[#E4E5E8]">
                Confirm: distribute {formatTokenAmount(amount || '0')} TDX to this user?
              </p>
              <p className="mt-0.5 text-[10px] text-[#A1A4AE]">
                Reason: {description.trim() || '—'}
              </p>
              <p className="mt-0.5 text-[10px] text-[#A1A4AE]">
                Category: {bonusCategory.replace(/_/g, ' ')}
              </p>
              <p className="mt-0.5 text-[10px] text-[#A1A4AE]">
                {wagerEnabled
                  ? `Wagering: YES · ${selectedMultiplier}X`
                  : 'Wagering: NO (non-wagerable)'}
                {wagerEnabled && expiresAt
                  ? ` · expires ${new Date(expiresAt).toLocaleString()}`
                  : ''}
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
        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">
          Recent Bonuses
        </p>
        {historyLoading ? (
          <div className="mt-2 space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : history.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-[#70737E]">
            No bonuses distributed to this user yet.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {history.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-lg bg-[#15161C] px-2 py-1.5 border border-[#202229]"
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-normal break-words text-[11px] font-semibold text-[#F5F5F7]">
                    {item.description}
                  </p>
                  <p className="text-[10px] text-[#A1A4AE]">
                    {item.bonusCategory
                      ? `${item.bonusCategory.replace(/_/g, ' ')} · `
                      : ''}
                    {formatRelativeTime(item.createdAt)}
                    {item.adminEmail ? ` · by ${item.adminEmail}` : ''}
                    {item.wageringRequired ? ' · wagering' : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-bold text-[#4ADE80]">
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
        <div className="w-full max-w-4xl rounded-[16px] border border-[#292B33] bg-[#15161C] p-6 shadow-xl">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 bg-[#202229] rounded animate-pulse w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/50 p-4">
        <div className="w-full max-w-md rounded-[16px] border border-[#4A2323] bg-[#281313] p-6 shadow-xl text-center">
          <p className="font-bold text-[#F87171]">Error loading user details</p>
          <p className="mt-2 text-sm text-[#A1A4AE]">{error || 'Unknown error'}</p>
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
      <div className="w-full max-w-4xl rounded-[16px] border border-[#292B33] bg-[#15161C] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-black text-[#F5F5F7]">User Details</h2>
          <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={onClose}>
            <X size={14} className="mr-1" /> Close
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 text-xs text-[#E4E5E8] sm:grid-cols-2">
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">User ID</p>
            <p className="mt-0.5 font-mono font-semibold text-[#F5F5F7]">{user.id}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Wallet Address</p>
            <p className="mt-0.5 font-mono font-semibold text-[#F5F5F7]">{user.walletAddress || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Mobile Number</p>
            <p className="mt-0.5 font-semibold text-[#F5F5F7]">{user.mobileNumber || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Email</p>
            <p className="mt-0.5 font-semibold break-all text-[#F5F5F7]">{user.email || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Status</p>
            <div className="mt-0.5">
              <Badge variant={getUserStatusBadgeVariant(user.status)}>
                {formatUserStatus(user.status)}
              </Badge>
            </div>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Created At</p>
            <p className="mt-0.5 font-semibold text-[#F5F5F7]">{formatDateTime(user.createdAt)}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Referral Code</p>
            <p className="mt-0.5 font-bold text-[#F5F5F7]">{user.referralCode || '—'}</p>
          </div>
          <div className="rounded-xl border border-[#202229] bg-[#15161C] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Referred By</p>
            <p className="mt-0.5 font-mono text-[#F5F5F7]">{user.referredBy ? formatAddress(user.referredBy) : '—'}</p>
          </div>
        </div>

        {balance && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">TDX Balance</p>
            <div className="mt-2 flex gap-2">
              <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229] flex-1">
                <p className="text-[#A1A4AE]">Available</p>
                <p className="text-base font-bold text-[#4ADE80]">{formatBalance(balance.availableBalance)} TDX</p>
              </div>
              <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229] flex-1">
                <p className="text-[#A1A4AE]">Locked</p>
                <p className="text-base font-bold text-[#F59E0B]">{formatBalance(balance.lockedBalance)} TDX</p>
              </div>
              <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229] flex-1">
                <p className="text-[#A1A4AE]">Total</p>
                <p className="text-base font-bold text-[#F5F5F7]">{formatBalance(balance.totalBalance)} TDX</p>
              </div>
            </div>
          </div>
        )}

        <BonusDistributionSection
          userId={userId}
          onDistributed={() => setReloadKey((k) => k + 1)}
        />

        <div className="mt-4 rounded-xl border border-[#202229] bg-[#15161C] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Financial Summary</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <div className="flex items-center justify-center gap-1 text-[#4ADE80]">
                <TrendingDown size={14} />
                <p className="text-[#A1A4AE] text-[10px]">Deposits</p>
              </div>
              <p className="text-base font-bold text-[#F5F5F7]">{formatBalance(stats.deposits)} TDX</p>
            </div>
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <div className="flex items-center justify-center gap-1 text-[#F87171]">
                <TrendingUp size={14} />
                <p className="text-[#A1A4AE] text-[10px]">Withdrawals</p>
              </div>
              <p className="text-base font-bold text-[#F5F5F7]">{formatBalance(stats.withdrawals)} TDX</p>
            </div>
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <div className="flex items-center justify-center gap-1 text-[#60A5FA]">
                <Wallet size={14} />
                <p className="text-[#A1A4AE] text-[10px]">Net Flow</p>
              </div>
              <p className={`text-base font-bold ${parseFloat(stats.deposits) - parseFloat(stats.withdrawals) >= 0 ? 'text-[#4ADE80]' : 'text-[#F87171]'}`}>
                {(parseFloat(stats.deposits) - parseFloat(stats.withdrawals)).toFixed(2)} TDX
              </p>
            </div>
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <div className="flex items-center justify-center gap-1 text-[#A78BFA]">
                <History size={14} />
                <p className="text-[#A1A4AE] text-[10px]">Total Trades</p>
              </div>
              <p className="text-base font-bold text-[#F5F5F7]">{stats.totalTrades}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#202229] bg-[#15161C] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Trade Statistics</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 text-xs">
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <p className="text-[#A1A4AE]">Total Volume</p>
              <p className="text-base font-bold text-[#F5F5F7]">{formatBalance(stats.totalTradeVolume)} TDX</p>
            </div>
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <p className="text-[#A1A4AE]">Total Profit</p>
              <p className="text-base font-bold text-[#4ADE80]">{formatBalance(stats.totalProfit)} TDX</p>
            </div>
            <div className="rounded-lg bg-[#15161C] p-2 text-center border border-[#202229]">
              <p className="text-[#A1A4AE]">Total Loss</p>
              <p className="text-base font-bold text-[#F87171]">{formatBalance(stats.totalLoss)} TDX</p>
            </div>
          </div>
        </div>

        {user.referrerWalletAddress && (
          <div className="mt-4 rounded-xl border border-[#202229] bg-[#15161C] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#A1A4AE]">Referrer</p>
            <p className="mt-1 font-mono text-[#F5F5F7]">{user.referrerWalletAddress}</p>
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
      <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#F5F5F7]">Users</h1>
            <p className="mt-0.5 text-xs text-[#A1A4AE]">Manage platform users and account status</p>
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
        <section className="rounded-[16px] border border-[#292B33] bg-[#15161C] p-4">
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
        <section className="overflow-hidden rounded-[16px] border border-[#292B33] bg-[#15161C]">
          {users.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#E4E5E8]">No users found</p>
              <p className="mt-1 text-xs text-[#A1A4AE]">Try changing status, search text, or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full divide-y divide-[#202229]">
                  <thead className="bg-[#15161C]">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">ID</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Mobile / Email</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Referral</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Balance</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#A1A4AE]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1B1917] bg-[#15161C]">
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

      {/* User Detail Modal */}
      {selectedUserId && (
        <UserDetailModal userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </div>
  );
}