// frontend/src/admin/screens/AdminWithdrawalsScreen.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X, CheckSquare } from 'lucide-react';
import { usePublicClient, useWriteContract } from 'wagmi';

import { AdminService } from '../services/admin.service';
import type { AdminWithdrawal, AdminWithdrawalFilterStatus, AdminWithdrawalStatus } from '../types/admin.types';
import { Badge, Button, ErrorState, Skeleton } from '../../components/ui';
import { useWalletContext } from '../../wallet/context/WalletContext';
import {
  WITHDRAWAL_VAULT_ADDRESS,
  WITHDRAWAL_VAULT_ABI,
  WITHDRAWAL_VAULT_MAX_BATCH_SIZE,
} from '../../wallet/config/withdrawalVault';
import { TransactionStatusPopup } from '../../wallet/components/TransactionStatusPopup';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const BULK_ELIGIBLE_WITHDRAWAL_STATUS: AdminWithdrawalStatus = 'PENDING_ADMIN_APPROVAL';

const WITHDRAWAL_STATUS_OPTIONS: Array<{
  label: string;
  value: AdminWithdrawalFilterStatus;
}> = [
  { label: 'All Statuses', value: 'ALL' },
  { label: 'Requested', value: 'REQUESTED' },
  { label: 'Risk Checking', value: 'RISK_CHECKING' },
  { label: 'Liquidity Check', value: 'LIQUIDITY_CHECK' },
  { label: 'Pending Admin Approval', value: 'PENDING_ADMIN_APPROVAL' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Queued', value: 'QUEUED' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Sent', value: 'SENT' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Hold', value: 'HOLD' },
];

const WITHDRAWAL_STATUS_BADGE_VARIANTS: Record<
  AdminWithdrawalStatus,
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  REQUESTED: 'warning',
  RISK_CHECKING: 'warning',
  LIQUIDITY_CHECK: 'warning',
  PENDING_ADMIN_APPROVAL: 'warning',
  APPROVED: 'info',
  REJECTED: 'error',
  QUEUED: 'info',
  PROCESSING: 'info',
  SENT: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  FAILED: 'error',
  HOLD: 'warning',
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

function formatWithdrawalStatus(status: AdminWithdrawalStatus): string {
  return status.toLowerCase().split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function WithdrawalFilters({
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
  status: AdminWithdrawalFilterStatus;
  limit: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: AdminWithdrawalFilterStatus) => void;
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
            placeholder="Search by withdrawal ID, user ID, or wallet"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-full rounded-[10px] border border-[#D0D5DD] bg-white pl-9 pr-3 py-2 text-sm text-[#111827] placeholder:text-[#98A2B3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
          />
        </div>

        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as AdminWithdrawalFilterStatus)}
          className="rounded-[10px] border border-[#D0D5DD] bg-white px-3 py-2 text-sm font-semibold text-[#111827] outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]"
        >
          {WITHDRAWAL_STATUS_OPTIONS.map((option) => (
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

function WithdrawalTableRow({
  withdrawal,
  isSelected,
  isPendingApprove,
  isPendingReject,
  isPendingReleaseHold,
  isPendingRevalidate,
  isAnyActionRunning,
  onSelect,
  onApprove,
  onReject,
  onReleaseHold,
  onRevalidate,
}: {
  withdrawal: AdminWithdrawal;
  isSelected: boolean;
  isPendingApprove: boolean;
  isPendingReject: boolean;
  isPendingReleaseHold: boolean;
  isPendingRevalidate: boolean;
  isAnyActionRunning: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onApprove: (withdrawal: AdminWithdrawal) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onReleaseHold: (id: string) => Promise<void>;
  onRevalidate: (id: string) => Promise<void>;
}) {
  const isEligible = withdrawal.status === BULK_ELIGIBLE_WITHDRAWAL_STATUS;
  const isDisabled = !isEligible || isAnyActionRunning;
  const normalizedTxHash = typeof withdrawal.txHash === 'string' ? withdrawal.txHash.trim() : '';
  const hasRecordedTxHash = normalizedTxHash.length > 0;
  const canRevalidateApprovedPayout = (
    withdrawal.status === 'APPROVED' &&
    !hasRecordedTxHash &&
    !withdrawal.payoutAttempted
  );

  return (
    <tr className="align-top transition-colors hover:bg-[#F8FAFC]">
      <td className="px-3 py-2 text-xs text-[#111827]">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={isDisabled}
          onChange={(e) => onSelect(withdrawal.id, e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-[#D0D5DD] text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Select withdrawal ${withdrawal.id}`}
        />
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-mono font-bold">{withdrawal.id.slice(0, 8)}...</p>
        <p className="mt-1 text-[10px] text-[#667085]">User: {withdrawal.userId.slice(0, 8)}...</p>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">{formatAddress(withdrawal.walletAddress)}</td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        <p className="font-bold">{formatTokenAmount(withdrawal.tdxAmount)}</p>
        <p className="mt-1 text-[10px] text-[#667085]">{formatTokenAmount(withdrawal.usdtAmount, 'USDT')}</p>
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={WITHDRAWAL_STATUS_BADGE_VARIANTS[withdrawal.status]}>
          {formatWithdrawalStatus(withdrawal.status)}
        </Badge>
      </td>
      <td className="px-3 py-2 text-xs text-[#111827]">
        {withdrawal.status === 'HOLD' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isPendingReleaseHold}
              disabled={isPendingApprove || isPendingReject || isAnyActionRunning}
              onClick={() => void onReleaseHold(withdrawal.id)}
            >
              Release Hold
            </Button>
          </div>
        ) : canRevalidateApprovedPayout ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isPendingRevalidate}
              disabled={isPendingApprove || isPendingReject || isPendingReleaseHold || isAnyActionRunning}
              onClick={() => void onRevalidate(withdrawal.id)}
            >
              Revalidate
            </Button>
          </div>
        ) : withdrawal.status === 'PENDING_ADMIN_APPROVAL' ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isPendingApprove}
              disabled={isPendingReject || isPendingReleaseHold || isAnyActionRunning}
              onClick={() => void onApprove(withdrawal)}
            >
              Approve & Pay
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              loading={isPendingReject}
              disabled={isPendingApprove || isPendingReleaseHold || isAnyActionRunning}
              onClick={() => void onReject(withdrawal.id)}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-[#98A2B3]">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[#111827] cursor-help">{formatRelativeTime(withdrawal.createdAt)}</td>
      <td className="px-3 py-2 text-xs text-[#111827] font-mono">
        {hasRecordedTxHash ? formatAddress(normalizedTxHash) : '—'}
      </td>
    </tr>
  );
}

export default function AdminWithdrawalsScreen() {
  const { address } = useWalletContext();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // ✅ Bulk selection state
  const [selectedWithdrawalIds, setSelectedWithdrawalIds] = useState<string[]>([]);

  // Payout status popup
  const [payoutStatus, setPayoutStatus] = useState<
    'processing' | 'success' | 'paymentNotDone' | 'error' | null
  >(null);
  const [payoutStatusMessage, setPayoutStatusMessage] = useState<string | null>(null);
  const [payoutTxHash, setPayoutTxHash] = useState<string | null>(null);
  const [payoutAmountLabel, setPayoutAmountLabel] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AdminWithdrawalFilterStatus>('ALL');
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState(0);

  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [pendingReleaseHoldId, setPendingReleaseHoldId] = useState<string | null>(null);
  const [pendingRevalidatePayoutId, setPendingRevalidatePayoutId] = useState<string | null>(null);

  const bulkSelectAllRef = useRef<HTMLInputElement | null>(null);

  // ✅ Get eligible withdrawal IDs from current page
  const eligibleCurrentPageWithdrawalIds = useMemo(
    () => withdrawals
      .filter((w) => w.status === BULK_ELIGIBLE_WITHDRAWAL_STATUS)
      .map((w) => w.id),
    [withdrawals],
  );

  const selectedEligibleWithdrawalIds = useMemo(
    () => selectedWithdrawalIds.filter((id) => eligibleCurrentPageWithdrawalIds.includes(id)),
    [eligibleCurrentPageWithdrawalIds, selectedWithdrawalIds],
  );

  const hasEligibleCurrentPageWithdrawals = eligibleCurrentPageWithdrawalIds.length > 0;
  const selectedCount = selectedEligibleWithdrawalIds.length;
  const allEligibleCurrentPageSelected = hasEligibleCurrentPageWithdrawals &&
    selectedCount === eligibleCurrentPageWithdrawalIds.length;
  const hasPartialSelection = selectedCount > 0 && !allEligibleCurrentPageSelected;

  // ✅ Update indeterminate state of select all checkbox
  useEffect(() => {
    if (bulkSelectAllRef.current) {
      bulkSelectAllRef.current.indeterminate = hasPartialSelection;
    }
  }, [hasPartialSelection]);

  // ✅ Clear selection when filters change
  useEffect(() => {
    setSelectedWithdrawalIds([]);
  }, [status, search, offset, limit]);

  const loadWithdrawals = useCallback(async (options?: { withLoader?: boolean }) => {
    const withLoader = options?.withLoader ?? true;
    if (withLoader) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const result = await AdminService.getAdminWithdrawals({
        limit,
        offset,
        status,
        search,
      });
      setWithdrawals(result.data);
      setTotal(result.total);
    } catch (err) {
      setError(AdminService.getErrorMessage(err));
      setWithdrawals([]);
      setTotal(0);
    } finally {
      if (withLoader) setLoading(false);
      else setRefreshing(false);
    }
  }, [limit, offset, search, status]);

  useEffect(() => {
    void loadWithdrawals({ withLoader: true });
  }, [loadWithdrawals]);

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
    setSelectedWithdrawalIds([]);
  }, []);

  // ✅ Selection handlers
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedWithdrawalIds(eligibleCurrentPageWithdrawalIds);
    } else {
      setSelectedWithdrawalIds([]);
    }
  }, [eligibleCurrentPageWithdrawalIds]);

  const handleSelectOne = useCallback((id: string, checked: boolean) => {
    if (checked) {
      setSelectedWithdrawalIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      setSelectedWithdrawalIds((prev) => prev.filter((item) => item !== id));
    }
  }, []);

  const handleApprove = useCallback(async (withdrawal: AdminWithdrawal) => {
    console.log('🔍 [APPROVE] Starting approval for withdrawal:', withdrawal.id);

    if (!address) {
      console.error('❌ [APPROVE] No admin wallet connected');
      setToast({ message: 'Please connect your admin wallet first', type: 'error' });
      return;
    }

    if (!publicClient) {
      console.error('❌ [APPROVE] No public client available');
      setToast({ message: 'Blockchain client not ready', type: 'error' });
      return;
    }

    if (withdrawal.status !== 'PENDING_ADMIN_APPROVAL') {
      console.error('❌ [APPROVE] Invalid status:', withdrawal.status);
      setToast({ message: 'Withdrawal is no longer pending approval', type: 'error' });
      return;
    }

    setPendingApproveId(withdrawal.id);

    setPayoutTxHash(null);
    setPayoutAmountLabel(`${withdrawal.usdtAmount} USDT`);
    setPayoutStatusMessage('Processing withdrawal payment...');
    setPayoutStatus('processing');

    try {
      await AdminService.approveWithdrawal(withdrawal.id, address);

      const payout = AdminService.prepareUsdtPayout(withdrawal);

      const txHash = await writeContractAsync({
        address: WITHDRAWAL_VAULT_ADDRESS,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'withdraw',
        args: [[payout.recipient], [payout.amountWei]],
      });
      console.log('✅ [APPROVE] Transaction sent:', txHash);
      setPayoutTxHash(txHash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log('✅ [APPROVE] Transaction confirmed:', {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      if (receipt.status !== 'success') {
        console.error('❌ [APPROVE] Transaction failed on-chain');
        setPayoutStatus('paymentNotDone');
        setPayoutStatusMessage('Transaction failed on-chain. Please reconcile this withdrawal.');
        setToast({ message: 'Transaction failed on-chain', type: 'error' });
        await loadWithdrawals({ withLoader: false });
        return;
      }

      await AdminService.completeWithdrawal(withdrawal.id, txHash);
      console.log('✅ [APPROVE] Withdrawal completed successfully');

      setPayoutStatus('success');
      setPayoutStatusMessage('Withdrawal completed successfully!');

      setToast({
        message: `Withdrawal approved, paid, and completed successfully (${txHash.slice(0, 10)}...)`,
        type: 'success',
      });

      // ✅ Remove from selection if completed
      setSelectedWithdrawalIds((prev) => prev.filter((id) => id !== withdrawal.id));

      await loadWithdrawals({ withLoader: false });
    } catch (err) {
      console.error('❌ [APPROVE] Error:', err);
      const errorMessage = AdminService.getErrorMessage(err);

      if (errorMessage.toLowerCase().includes('user rejected') || errorMessage.toLowerCase().includes('denied')) {
        setPayoutStatus('paymentNotDone');
        setPayoutStatusMessage('Transaction was rejected in wallet. Withdrawal remains APPROVED.');
        setToast({ message: 'Transaction was rejected in wallet', type: 'error' });
      } else if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('conflict')) {
        setPayoutStatus('error');
        setPayoutStatusMessage('Withdrawal status has changed. Please refresh.');
        setToast({ message: 'Withdrawal status has changed. Please refresh.', type: 'error' });
        await loadWithdrawals({ withLoader: false });
      } else {
        setPayoutStatus('error');
        setPayoutStatusMessage(errorMessage);
        setToast({ message: errorMessage, type: 'error' });
      }
    } finally {
      setPendingApproveId(null);
      console.log('🔍 [APPROVE] Approval flow finished (verify completion state before relying on it)');
    }
  }, [address, publicClient, writeContractAsync, loadWithdrawals]);

  // ✅ Bulk approve: ONE WithdrawalVault.withdraw() batch transaction for all selected
  const handleBulkApprove = useCallback(async () => {
    if (selectedEligibleWithdrawalIds.length === 0) {
      setToast({ message: 'No eligible withdrawals selected', type: 'error' });
      return;
    }

    if (selectedEligibleWithdrawalIds.length > WITHDRAWAL_VAULT_MAX_BATCH_SIZE) {
      setToast({
        message: `Batch payout limit is ${WITHDRAWAL_VAULT_MAX_BATCH_SIZE} withdrawals per transaction`,
        type: 'error',
      });
      return;
    }

    if (!address) {
      setToast({ message: 'Please connect your admin wallet first', type: 'error' });
      return;
    }

    if (!publicClient) {
      setToast({ message: 'Blockchain client not ready', type: 'error' });
      return;
    }

    // ✅ Confirm before batch payout
    if (!window.confirm(`Approve and send a batch payout for ${selectedEligibleWithdrawalIds.length} withdrawal(s)?`)) {
      return;
    }

    // ✅ Collect only the currently eligible withdrawals
    const selectedWithdrawals = selectedEligibleWithdrawalIds
      .map((id) => withdrawals.find((w) => w.id === id))
      .filter((w): w is AdminWithdrawal => Boolean(w && w.status === BULK_ELIGIBLE_WITHDRAWAL_STATUS));

    if (selectedWithdrawals.length !== selectedEligibleWithdrawalIds.length) {
      setToast({ message: 'Some selected withdrawals are no longer eligible', type: 'error' });
      return;
    }

    setPendingApproveId('bulk');
    setPayoutTxHash(null);
    setPayoutAmountLabel(`${selectedWithdrawals.length} withdrawal payout(s) batched`);
    setPayoutStatusMessage(`Preparing batch payout for ${selectedWithdrawals.length} withdrawal(s)...`);
    setPayoutStatus('processing');

    try {
      // ✅ Client-side validation + exact-token math (USDT_DECIMALS = 18 via prepareUsdtPayout)
      const payouts = selectedWithdrawals.map((w) => AdminService.prepareUsdtPayout(w));

      const recipients = payouts.map((p) => p.recipient);
      const amountsWei = payouts.map((p) => p.amountWei);

      if (recipients.length !== amountsWei.length) {
        throw new Error('Recipient and amount arrays are not aligned.');
      }

      const uniqueRecipients = new Set(recipients.map((r) => r.toLowerCase()));
      if (uniqueRecipients.size !== recipients.length) {
        throw new Error('Duplicate recipient wallets are not allowed in one batch payout.');
      }

      // ✅ Approve each withdrawal (state transition: PENDING_ADMIN_APPROVAL -> APPROVED)
      for (const withdrawal of selectedWithdrawals) {
        await AdminService.approveWithdrawal(withdrawal.id, address);
      }

      setPayoutStatusMessage('Batch transaction submitted. Waiting for wallet confirmation...');

      // ✅ ONE blockchain transaction for the whole batch
      const txHash = await writeContractAsync({
        address: WITHDRAWAL_VAULT_ADDRESS,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'withdraw',
        args: [recipients, amountsWei],
      });
      console.log('✅ [BATCH] Batch transaction sent:', txHash);
      setPayoutTxHash(txHash);

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== 'success') {
        console.error('❌ [BATCH] Batch transaction failed on-chain');
        setPayoutStatus('paymentNotDone');
        setPayoutStatusMessage('Batch transaction failed on-chain. Withdrawals remain APPROVED.');
        setToast({ message: 'Batch transaction failed on-chain', type: 'error' });
        await loadWithdrawals({ withLoader: false });
        return;
      }

      // ✅ Backend independently verifies the single transaction + completes all atomically
      setPayoutStatusMessage('Verifying payout...');
      await AdminService.completeBatchWithdrawals(
        selectedWithdrawals.map((w) => w.id),
        txHash,
      );
      console.log('✅ [BATCH] Batch completed');

      setPayoutStatus('success');
      setPayoutStatusMessage(`${selectedWithdrawals.length} withdrawals completed successfully`);
      setToast({
        message: `Batch payout completed: ${selectedWithdrawals.length} withdrawals (${txHash.slice(0, 10)}...)`,
        type: 'success',
      });

      setSelectedWithdrawalIds([]);
      await loadWithdrawals({ withLoader: false });
    } catch (err) {
      console.error('❌ [BATCH] Error:', err);
      const errorMessage = AdminService.getErrorMessage(err);

      if (errorMessage.toLowerCase().includes('user rejected') || errorMessage.toLowerCase().includes('denied')) {
        setPayoutStatus('paymentNotDone');
        setPayoutStatusMessage('Transaction was rejected in wallet. Withdrawals remain APPROVED.');
        setToast({ message: 'Transaction was rejected in wallet', type: 'error' });
      } else if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('conflict')) {
        setPayoutStatus('error');
        setPayoutStatusMessage('Withdrawal status has changed. Please refresh.');
        setToast({ message: 'Withdrawal status has changed. Please refresh.', type: 'error' });
        await loadWithdrawals({ withLoader: false });
      } else {
        setPayoutStatus('error');
        setPayoutStatusMessage(errorMessage);
        setToast({ message: errorMessage, type: 'error' });
      }
    } finally {
      setPendingApproveId(null);
    }
  }, [selectedEligibleWithdrawalIds, withdrawals, address, publicClient, writeContractAsync, loadWithdrawals]);

  // ✅ Bulk reject all selected
  const handleBulkReject = useCallback(async () => {
    if (selectedEligibleWithdrawalIds.length === 0) {
      setToast({ message: 'No eligible withdrawals selected', type: 'error' });
      return;
    }

    const reason = window.prompt('Enter rejection reason for all selected withdrawals:', 'Bulk rejected by admin');
    if (reason === null) return;

    if (!window.confirm(`Reject ${selectedEligibleWithdrawalIds.length} withdrawal(s)?`)) {
      return;
    }

    setPendingRejectId('bulk');

    try {
      let successCount = 0;
      let failCount = 0;

      for (const id of selectedEligibleWithdrawalIds) {
        try {
          const withdrawal = withdrawals.find(w => w.id === id);
          if (!withdrawal || withdrawal.status !== 'PENDING_ADMIN_APPROVAL') {
            failCount++;
            continue;
          }
          await AdminService.rejectWithdrawal(id, reason.trim() || 'Rejected by admin');
          successCount++;
        } catch (error) {
          failCount++;
        }
      }

      setToast({
        message: `Bulk reject: ${successCount} successful, ${failCount} failed`,
        type: successCount > 0 ? 'success' : 'error',
      });

      setSelectedWithdrawalIds([]);
      await loadWithdrawals({ withLoader: false });
    } finally {
      setPendingRejectId(null);
    }
  }, [selectedEligibleWithdrawalIds, loadWithdrawals, withdrawals]);

  const handleReject = useCallback(async (id: string) => {
    const reason = window.prompt('Enter rejection reason:', 'Rejected by admin');
    if (reason === null) return;
    setPendingRejectId(id);
    try {
      await AdminService.rejectWithdrawal(id, reason.trim() || 'Rejected by admin');
      setToast({ message: 'Withdrawal rejected successfully', type: 'success' });
      setSelectedWithdrawalIds((prev) => prev.filter((item) => item !== id));
      await loadWithdrawals({ withLoader: false });
    } catch (err) {
      const errorMessage = AdminService.getErrorMessage(err);
      if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('conflict')) {
        setToast({ message: 'Withdrawal status has changed. Please refresh.', type: 'error' });
        await loadWithdrawals({ withLoader: false });
      } else {
        setToast({ message: errorMessage, type: 'error' });
      }
    } finally {
      setPendingRejectId(null);
    }
  }, [loadWithdrawals]);

  const handleReleaseHold = useCallback(async (id: string) => {
    const confirmed = window.confirm('Are you sure you want to release this withdrawal hold?');
    if (!confirmed) return;
    setPendingReleaseHoldId(id);
    try {
      await AdminService.releaseWithdrawalHold(id);
      setToast({ message: 'Withdrawal hold released successfully', type: 'success' });
      await loadWithdrawals({ withLoader: false });
    } catch (err) {
      const errorMessage = AdminService.getErrorMessage(err);
      if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('conflict')) {
        setToast({ message: 'Withdrawal status has changed. Please refresh.', type: 'error' });
        await loadWithdrawals({ withLoader: false });
      } else {
        setToast({ message: errorMessage, type: 'error' });
      }
    } finally {
      setPendingReleaseHoldId(null);
    }
  }, [loadWithdrawals]);

  const handleRevalidate = useCallback(async (id: string) => {
    const confirmed = window.confirm(
      'Revalidate this stuck APPROVED withdrawal and return it to Pending Admin Approval? This will not refund TDX and will not trigger any USDT transfer.'
    );
    if (!confirmed) return;
    setPendingRevalidatePayoutId(id);
    try {
      await AdminService.revalidateWithdrawalPayout(id);
      setToast({ message: 'Withdrawal revalidated and returned to pending admin approval', type: 'success' });
      await loadWithdrawals({ withLoader: false });
    } catch (err) {
      const errorMessage = AdminService.getErrorMessage(err);
      if (errorMessage.toLowerCase().includes('409') || errorMessage.toLowerCase().includes('conflict')) {
        setToast({ message: 'Payout evidence exists. Blockchain reconciliation is required.', type: 'error' });
        await loadWithdrawals({ withLoader: false });
      } else {
        setToast({ message: errorMessage, type: 'error' });
      }
    } finally {
      setPendingRevalidatePayoutId(null);
    }
  }, [loadWithdrawals]);

  const isAnyActionRunning = Boolean(
    pendingApproveId ||
    pendingRejectId ||
    pendingReleaseHoldId ||
    pendingRevalidatePayoutId
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const canGoPrev = offset > 0;
  const canGoNext = offset + limit < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(offset + withdrawals.length, total);

  return (
    <div className="space-y-3">
      {/* Payout Status Popup */}
      {payoutStatus && (
        <TransactionStatusPopup
          open
          kind={payoutStatus}
          title={
            payoutStatus === 'success'
              ? 'Success'
              : payoutStatus === 'paymentNotDone'
                ? 'Payment Not Done'
                : payoutStatus === 'error'
                  ? 'Error'
                  : undefined
          }
          description={payoutStatusMessage ?? undefined}
          amountLabel={payoutAmountLabel ?? undefined}
          txHash={payoutTxHash ?? undefined}
          onClose={() => {
            setPayoutStatus(null);
            setPayoutStatusMessage(null);
            setPayoutTxHash(null);
            setPayoutAmountLabel(null);
          }}
          closeLabel={payoutStatus === 'success' ? 'Done' : 'Close'}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`rounded-[12px] border px-4 py-3 ${
          toast.type === 'success'
            ? 'border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]'
            : 'border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{toast.message}</p>
            <button onClick={() => setToast(null)} className="text-[#667085] hover:text-[#111827]">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-black text-[#111827]">Withdrawals</h1>
            <p className="mt-0.5 text-xs text-[#667085]">Review and manage withdrawal requests with search, filtering, and bulk actions</p>
            {total > 0 && (
              <p className="mt-1 text-xs font-semibold text-[#111827]">
                Total: {total} withdrawal{total === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" className="h-9 px-3 text-xs" loading={refreshing} onClick={() => void loadWithdrawals({ withLoader: false })}>
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
      </section>

      <WithdrawalFilters
        searchInput={searchInput}
        status={status}
        limit={limit}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={applySearch}
        onStatusChange={(val) => { setStatus(val); setOffset(0); }}
        onLimitChange={(val) => { setLimit(val); setOffset(0); }}
        onReset={resetFilters}
      />

      {/* ✅ Bulk Actions Bar */}
      {selectedCount > 0 && (
        <section className="rounded-[12px] border border-[#B9E6FE] bg-[#F0F9FF] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckSquare size={16} className="text-[#0C4A6E]" />
              <p className="text-xs font-semibold text-[#0C4A6E]">
                {selectedCount} withdrawal{selectedCount === 1 ? '' : 's'} selected
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={isAnyActionRunning}
                onClick={handleBulkApprove}
              >
                Approve & Send Batch Payout
              </Button>

              <Button
                variant="danger"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={isAnyActionRunning}
                onClick={handleBulkReject}
              >
                Reject Selected
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={isAnyActionRunning}
                onClick={() => setSelectedWithdrawalIds([])}
              >
                Clear
              </Button>
            </div>
          </div>
        </section>
      )}

      {loading && !withdrawals.length && (
        <section className="rounded-[16px] border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`withdrawal-skeleton-${i}`} className="grid grid-cols-8 gap-2">
                {Array.from({ length: 8 }).map((__, j) => (
                  <Skeleton key={`withdrawal-skeleton-${i}-${j}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && error && (
        <ErrorState title="Unable to load withdrawals" description={error} onRetry={() => void loadWithdrawals({ withLoader: true })} />
      )}

      {!loading && !error && (
        <section className="overflow-hidden rounded-[16px] border border-[#E5E7EB] bg-white">
          {withdrawals.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-base font-bold text-[#344054]">No withdrawals found</p>
              <p className="mt-1 text-xs text-[#667085]">Try changing status, search text, or pagination options.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-[1080px] w-full divide-y divide-[#EAECF0]">
                  <thead className="bg-[#F9FAFB]">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">
                        <input
                          ref={bulkSelectAllRef}
                          type="checkbox"
                          checked={allEligibleCurrentPageSelected}
                          disabled={!hasEligibleCurrentPageWithdrawals || isAnyActionRunning}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="h-4 w-4 cursor-pointer rounded border-[#D0D5DD] text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800] disabled:cursor-not-allowed"
                          aria-label="Select all eligible withdrawals"
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">ID</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Wallet</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Amount</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Status</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Actions</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Created</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F4F7] bg-white">
                    {withdrawals.map((withdrawal) => (
                      <WithdrawalTableRow
                        key={withdrawal.id}
                        withdrawal={withdrawal}
                        isSelected={selectedWithdrawalIds.includes(withdrawal.id)}
                        isPendingApprove={pendingApproveId === withdrawal.id || pendingApproveId === 'bulk'}
                        isPendingReject={pendingRejectId === withdrawal.id || pendingRejectId === 'bulk'}
                        isPendingReleaseHold={pendingReleaseHoldId === withdrawal.id}
                        isPendingRevalidate={pendingRevalidatePayoutId === withdrawal.id}
                        isAnyActionRunning={isAnyActionRunning}
                        onSelect={handleSelectOne}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onReleaseHold={handleReleaseHold}
                        onRevalidate={handleRevalidate}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    disabled={!canGoPrev}
                    onClick={() => {
                      setSelectedWithdrawalIds([]);
                      setOffset(Math.max(0, offset - limit));
                    }}
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
                    onClick={() => {
                      setSelectedWithdrawalIds([]);
                      setOffset(offset + limit);
                    }}
                  >
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