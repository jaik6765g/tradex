// frontend/src/wallet/withdrawal/screens/WithdrawalScreen.tsx

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  ArrowUpFromLine,
  Check,
  Loader2,
  ShieldAlert,
  Wallet,
  History,
} from 'lucide-react';

// ✅ FIXED: Correct import paths
import { useWalletContext } from '../../../wallet/context/WalletContext';
import { useWithdraw } from '../hooks/useWithdraw';
import { apiClient } from '../../../core/api/client';

import { useWalletLimits } from '../../../wallet/hooks/useWalletLimits';
import { TDX_RATE } from '../../../wallet/config/wallet';
import {
  compareDecimalStrings,
  formatDecimalString,
  isPositiveDecimal,
  trimDecimalZeros,
  usdtToTdx,
  tdxToUsdt,
} from '../utils/money';
import {
  MAX_USDT_WITHDRAWAL,
  MIN_USDT_WITHDRAWAL,
} from '../../../wallet/config/wallet';

// ============================================================
// TYPES
// ============================================================

interface Transaction {
  id: string;
  type: 'withdrawal';
  amount: string;
  status: 'pending' | 'completed' | 'failed' | 'rejected' | 'approved';
  createdAt: string;
}

// ============================================================
// SAVED PAYOUT — the withdrawal destination (address + chain) is
// persisted on the device, so EVERY withdrawal always goes to the
// same saved address until the user changes it.
// ============================================================

const PAYOUT_STORAGE_KEY = 'tradex_withdraw_payout';

export interface SavedPayout {
  address: string;
  chain: string;
  savedAt: number;
}

/**
 * Renders a backend resetsAt ISO instant as a short local countdown/datetime
 * string ("resets in 3h 12m" or the local date when far away). Pure display
 * helper — no financial math.
 */
const formatResetCountdown = (iso: string): string => {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 'at the next reset';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'at the next reset';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `in ${minutes}m`;
  if (hours < 48) return `in ${hours}h ${minutes}m`;
  return new Date(target).toLocaleString();
};

/** Supported payout chains (backend pays out on BSC/BEP-20). */
const SUPPORTED_CHAINS = [{ id: 'BSC', label: 'BSC (BEP-20)' }] as const;

const loadSavedPayout = (): SavedPayout | null => {
  try {
    const raw = localStorage.getItem(PAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPayout>;
    if (!parsed?.address || !parsed?.chain) return null;
    return {
      address: parsed.address,
      chain: parsed.chain,
      savedAt: parsed.savedAt ?? 0,
    };
  } catch {
    return null;
  }
};

const persistPayout = (address: string, chain: string): void => {
  try {
    localStorage.setItem(
      PAYOUT_STORAGE_KEY,
      JSON.stringify({ address, chain, savedAt: Date.now() }),
    );
  } catch {
    // Storage unavailable — the address still works for this session.
  }
};

// ============================================================
// COMPONENT
// ============================================================

export default function WithdrawalScreen() {
  const {
    isAuthenticated,
    userId,
    authUser,
    tdxBalance,
    usdtBalance,
    refresh: refreshWallet,
  } = useWalletContext();

  const [amount, setAmount] = useState('');
  const savedPayout = useMemo(() => loadSavedPayout(), []);
  const [payoutAddress, setPayoutAddress] = useState(
    savedPayout?.address || authUser?.walletAddress || '',
  );
  const [chain, setChain] = useState<string>(
    savedPayout?.chain || SUPPORTED_CHAINS[0].id,
  );
  const [isAddressSaved, setIsAddressSaved] = useState(() =>
    Boolean(savedPayout),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const { withdraw, status, error, isLoading, isSuccess, reset } = useWithdraw(userId);

  // Supplementary limits UI only — the backend enforces every limit inside
  // its locked transaction. The limits API returns exact USDT decimal
  // strings; TDX equivalents are derived with string arithmetic only.
  const { withdrawMin, withdrawMax, dailyWithdrawals } = useWalletLimits();

  // Account readiness — a signed-in account is enough (no wallet connection
  // hook call and the derived eligibility flags below depend on it.
  const accountReady = Boolean(isAuthenticated && userId);

  // final authority inside its locked withdrawal transaction.
  const {
    withdrawalEligible,
    remainingTdx,

  const trimInput = (raw: string): string => raw.trim();

  // --- Exact-limit view model (strings from the backend, strings only) ---
  const minUsdtRaw = Number.isFinite(withdrawMin) ? String(withdrawMin) : String(MIN_USDT_WITHDRAWAL);
  const maxUsdtRaw = Number.isFinite(withdrawMax) ? String(withdrawMax) : String(MAX_USDT_WITHDRAWAL);
  const minTdxExact = usdtToTdx(minUsdtRaw) ?? '0';
  const maxTdxExact = usdtToTdx(maxUsdtRaw) ?? '0';

  const amountTrimmed = trimInput(amount);
  const hasTypedAmount = amountTrimmed.length > 0;
  const amountValidDecimal = isPositiveDecimal(amountTrimmed);
  const amountBelowMin =
    amountValidDecimal && compareDecimalStrings(amountTrimmed, minTdxExact) === -1;
  const amountAboveMax =
    amountValidDecimal && compareDecimalStrings(amountTrimmed, maxTdxExact) === 1;

  // USDT preview of the typed amount — string division only, never a float.
  const usdtPreviewExact = amountValidDecimal ? tdxToUsdt(amountTrimmed) : null;

  // --- Derived eligibility (guidance only; backend is authoritative) ---
  // during the initial fetch.
    withdrawalEligible === false;

    remainingTdx !== null && remainingTdx !== undefined
      ? trimDecimalZeros(String(remainingTdx))
      : '0';

  // Withdrawable balance: exact display math only.
  const availableTdxRaw = String(tdxBalance ?? '0');
  const availableTdxDisplay = isPositiveDecimal(availableTdxRaw)
    ? trimDecimalZeros(availableTdxRaw)
    : '0';

  const withdrawableUsdtDisplay = !accountReady
    ? '—'
      ? '0'
      : isPositiveDecimal(availableTdxDisplay)
        ? (tdxToUsdt(availableTdxDisplay) ?? '0')
        : '0';

  // The withdrawal button stays disabled (blurred) until there is a real,
  // withdrawable amount — a 0 USDT withdrawable balance can never be submitted.
  const hasWithdrawableBalance =

  // Today's remaining withdrawals from the limits API — never hardcoded.
  const frequencyUnlimited = dailyWithdrawals.mode === 'UNLIMITED';
  const frequencyLimitValue =
    typeof dailyWithdrawals.value === 'number' ? dailyWithdrawals.value : null;
  const frequencyUsed =
    typeof dailyWithdrawals.usedToday === 'number' ? dailyWithdrawals.usedToday : null;
  const remainingWithdrawalsToday =
    frequencyUnlimited || frequencyLimitValue === null || frequencyUsed === null
      ? null
      : Math.max(0, frequencyLimitValue - frequencyUsed);
  const dailyLimitReached =
    remainingWithdrawalsToday !== null && remainingWithdrawalsToday <= 0;

  // No wallet connection required — a signed-in account with a payout
  // address is enough (the destination is entered by the user).
  const addressValid = /^0x[a-fA-F0-9]{40}$/.test(payoutAddress.trim());

  // --- Eligibility banner + submit gating ---

  const handlePayoutAddressChange = (value: string) => {
    setPayoutAddress(value);
    setIsAddressSaved(
      Boolean(savedPayout) &&
        value.trim().toLowerCase() === savedPayout!.address.trim().toLowerCase(),
    );
  };

  // Save the destination (address + chain) so every future withdrawal
  // defaults to it.
  const handleSavePayout = () => {
    const trimmed = payoutAddress.trim();
    if (!addressValid) return;
    persistPayout(trimmed, chain);
    setIsAddressSaved(true);
  };

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Display-only formatters. Financial values are formatted from exact decimal
  // strings — never via floating-point parsing.
  const formatTDX = (v: string | number | null | undefined): string =>
    formatDecimalString(v, 2);

  const formatUSDT = (v: string | number | null | undefined): string =>
    formatDecimalString(v, 2);

  const formatAmount = (v: string | number | null | undefined): string =>
    formatDecimalString(v, 2);

  const formatRelativeTime = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pending', className: 'bg-[#2A190D] text-[#F59E0B]' },
      processing: { label: 'Processing', className: 'bg-[#211810] text-[#C99752]' },
      completed: { label: 'Completed', className: 'bg-[#10251A] text-[#6EE7B7]' },
      failed: { label: 'Failed', className: 'bg-[#281313] text-[#F87171]' },
      rejected: { label: 'Rejected', className: 'bg-[#281313] text-[#F87171]' },
      approved: { label: 'Approved', className: 'bg-[#211810] text-[#C99752]' },
      cancelled: { label: 'Cancelled', className: 'bg-[#202229] text-[#A1A4AE]' },
    };
    return map[status] || { label: status, className: 'bg-[#202229] text-[#A1A4AE]' };
  };

  // ============================================================
  // FETCH WITHDRAWAL HISTORY
  // ============================================================

  const fetchHistory = async () => {
    if (!userId) return;
    setTransactionsLoading(true);
    try {
      const response = await apiClient.get('/withdrawals/my', {
        params: { limit: 10 },
      });
      const data = response.data?.data || response.data || [];
      setTransactions(data.map((w: any) => ({
        id: w.id,
        type: 'withdrawal' as const,
        amount: w.tdxAmount || w.usdtAmount || '0',
        status: w.status?.toLowerCase() || 'pending',
        createdAt: w.createdAt,
      })));
    } catch (error) {
      console.error('Failed to fetch withdrawal history:', error);
    } finally {
      setTransactionsLoading(false);
    }
  };

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory]);

  // ============================================================
  // HANDLERS
  // ============================================================

  // incomplete > daily limit reached > amount out of range. `blockReason`
  // decides both the banner and the button.
  type BlockReason =
    | 'LOGIN'
    | 'DAILY_LIMIT_REACHED'
    | 'NO_WITHDRAWABLE_BALANCE'
    | 'AMOUNT_BELOW_MIN'
    | 'AMOUNT_ABOVE_MAX'
    | 'AMOUNT_INVALID'
    | 'ADDRESS_INVALID'
    | null;

  const blockReason: BlockReason = !accountReady
    ? 'LOGIN'
      : dailyLimitReached
        ? 'DAILY_LIMIT_REACHED'
        : !hasWithdrawableBalance
          ? 'NO_WITHDRAWABLE_BALANCE'
          : !hasTypedAmount
            ? null
            : !amountValidDecimal
              ? 'AMOUNT_INVALID'
              : amountBelowMin
                ? 'AMOUNT_BELOW_MIN'
                : amountAboveMax
                  ? 'AMOUNT_ABOVE_MAX'
                  : !addressValid
                    ? 'ADDRESS_INVALID'
                    : null;

  const eligibilityBanner: {
    tone: 'amber' | 'green' | 'red';
    title: string;
    body: string;
  } | null = (() => {
    if (!accountReady) return null;
    switch (blockReason) {
        return {
          tone: 'amber',
        };
      case 'DAILY_LIMIT_REACHED':
        return {
          tone: 'red',
          title: "Today's withdrawal limit reached",
          body: dailyWithdrawals.resetsAt
            ? `You have used all ${frequencyLimitValue ?? ''} withdrawals allowed today. New requests open after ${formatResetCountdown(dailyWithdrawals.resetsAt)}.`
            : 'You have used all withdrawals allowed today. Please try again tomorrow.',
        };
      case 'NO_WITHDRAWABLE_BALANCE':
        return {
          tone: 'amber',
          title: 'No withdrawable balance',
        };
      // Amount and address problems are shown inline (next to the amount
      // input and the destination field), so they render no banner.
      case 'AMOUNT_BELOW_MIN':
      case 'AMOUNT_ABOVE_MAX':
      case 'AMOUNT_INVALID':
      case 'ADDRESS_INVALID':
        return null;
      default:
          return {
            tone: 'green',
            title: 'Withdrawal available',
          };
        }
        return null;
    }
  })();

  const handleUseMax = () => {
    // Gated by the same eligibility rules as the submit button: never writes
    // an amount the backend would reject. Uses the smaller of the available
    // balance and the per-transaction maximum, with exact string compares.
    if (!accountReady || isLoading) return;
    if (!isPositiveDecimal(availableTdxRaw)) return;
    const avail = trimDecimalZeros(availableTdxRaw);
    if (compareDecimalStrings(avail, minTdxExact) === -1) return;
    const capped = compareDecimalStrings(avail, maxTdxExact) === 1 ? maxTdxExact : avail;
    setAmount(capped);
  };

  // Exact string form of the USDT preview (display only).
  const usdtAmountExact = usdtPreviewExact ?? '0';
  void TDX_RATE;

  const handleWithdraw = async () => {
    if (!accountReady || !addressValid) return;
    // Every withdrawal goes to the SAVED destination — persist it here so
    // it is always pre-filled for future withdrawals.
    persistPayout(payoutAddress.trim(), chain);
    setIsAddressSaved(true);
    await withdraw(amount, payoutAddress.trim());
  };

  useEffect(() => {
    if (isSuccess) {
      void refreshWallet();
      const timer = setTimeout(() => {
        setAmount('');
        reset();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, reset, refreshWallet]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-[#111217] pb-24">
      <main className="mx-auto w-full max-w-[500px] px-4 py-5">
        <div className="space-y-4">
          {/* Header */}
          <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF7A18] text-white">
                <ArrowUpFromLine size={18} />
              </div>
              <div>
                <h1 className="text-[20px] font-black text-[#F5F5F7]">Withdraw</h1>
                <p className="text-xs text-[#A1A4AE]">100 TDX = 1 USDT</p>
              </div>
            </div>
          </section>

          {/* Auth Warning */}
          {!accountReady && (
            <section className="rounded-[18px] border border-[#3A281C] bg-[#2A1608] p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert size={20} className="mt-0.5 shrink-0 text-[#FDBA74]" />
                <div>
                  <p className="text-sm font-extrabold text-[#FDBA74]">Login required</p>
                  <p className="mt-1 text-xs text-[#FDBA74]">Log in with your mobile number before withdrawing.</p>
                </div>
              </div>
            </section>
          )}

          {/* Withdraw Panel */}
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-black text-[#F5F5F7]">Withdraw</h2>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#C99752] hover:text-[#C99752] transition"
              >
                <History size={14} />
                {showHistory ? 'Hide History' : 'View History'}
              </button>
            </div>

            {accountReady && (
              <>
                {/* Balance Display */}
                <div className="mt-4 rounded-xl bg-gradient-to-br from-[#211810] to-[#211810] border border-[#34261C] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#A1A4AE]">Available Balance</p>
                      <p className="text-2xl font-bold text-[#F5F5F7] mt-1">
                        {formatTDX(tdxBalance)} <span className="text-sm font-semibold text-[#A1A4AE]">TDX</span>
                      </p>
                      <p className="text-xs text-[#70737E] mt-0.5">
                        ≈ {formatUSDT(usdtBalance)} USDT
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-medium text-[#70737E] uppercase tracking-wider">Payout Address</p>
                      <p className="text-xs font-mono text-[#A1A4AE]">{formatAddress(payoutAddress)}</p>
                    </div>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-[#A1A4AE] mb-1">
                    Amount (TDX)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-3 border border-[#34343E] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF7A18] focus:border-transparent text-lg font-bold text-[#F5F5F7]"
                      disabled={isLoading}
                      min={minTdxExact}
                      max={maxTdxExact}
                      step="0.01"
                    />
                    <button
                      type="button"
                      onClick={handleUseMax}
                      disabled={
                        !accountReady ||
                        isLoading ||
                        dailyLimitReached
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#C99752] hover:text-[#C99752] disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Fill the largest withdrawable amount allowed by the current limits"
                    >
                      USE MAX
                    </button>
                  </div>
                </div>
                {/* Withdrawable Balance — the amount actually available to withdraw */}
                <p className="mt-2 text-xs font-semibold text-[#A1A4AE]">
                  Withdrawable Balance:{' '}
                  <span className={hasWithdrawableBalance ? 'text-[#4ADE80]' : 'text-[#FF8F3D]'}>
                      ? '…'
                      : `${formatDecimalString(withdrawableUsdtDisplay)} USDT`}
                  </span>
                </p>
                {(amountBelowMin || amountAboveMax) && (
                  <p className="text-xs text-[#F87171] mt-1">
                    {amountBelowMin
                      ? `Minimum withdrawal is ${formatDecimalString(minUsdtRaw)} USDT (${formatTDX(minTdxExact)} TDX).`
                      : `Maximum withdrawal per transaction is ${formatDecimalString(maxUsdtRaw)} USDT (${formatTDX(maxTdxExact)} TDX).`}
                  </p>
                )}

                {/* Eligibility banner — one prioritized status, never a stack */}
                {accountReady && eligibilityBanner && (
                  <div
                    role="status"
                    className={`mt-3 rounded-xl border p-3 ${
                      eligibilityBanner.tone === 'green'
                        ? 'border-[#123A24] bg-[#10251A]'
                        : eligibilityBanner.tone === 'amber'
                          ? 'border-[#8F4817] bg-[#2A190D]'
                          : 'border-[#4A2323] bg-[#281313]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {eligibilityBanner.tone === 'green' ? (
                        <Check size={16} className="mt-0.5 shrink-0 text-[#4ADE80]" />
                      ) : eligibilityBanner.tone === 'amber' ? (
                        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-[#FF8F3D]" />
                      ) : (
                        <AlertCircle size={16} className="mt-0.5 shrink-0 text-[#F87171]" />
                      )}
                      <div>
                        <p
                          className={`text-sm font-extrabold ${
                            eligibilityBanner.tone === 'green'
                              ? 'text-[#4ADE80]'
                              : eligibilityBanner.tone === 'amber'
                                ? 'text-[#FF8F3D]'
                                : 'text-[#F87171]'
                          }`}
                        >
                          {eligibilityBanner.title}
                        </p>
                        <p className="mt-0.5 text-xs text-[#A1A4AE]">{eligibilityBanner.body}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* USDT Preview */}
                {amountValidDecimal && (
                  <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#A1A4AE]">You will receive:</span>
                      <span className="text-lg font-bold text-[#4ADE80]">
                        {formatDecimalString(usdtAmountExact)} USDT
                      </span>
                    </div>
                  </div>
                )}

                {/* Destination Wallet — saved (address + chain persist); every
                    withdrawal is sent here */}
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-[#A1A4AE]">
                      Destination Wallet
                    </label>
                    {isAddressSaved && addressValid && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#4ADE80] bg-[#10251A] px-2 py-0.5 rounded-full border border-[#123A24]">
                        <Check size={10} />
                        Saved
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-[#34343E] bg-[#1B1917] px-4 py-3">
                    <Wallet size={16} className="text-[#70737E] shrink-0" />
                    <input
                      type="text"
                      value={payoutAddress}
                      onChange={(e) => handlePayoutAddressChange(e.target.value)}
                      placeholder="0x…"
                      spellCheck={false}
                      disabled={isLoading}
                      className="flex-1 bg-transparent text-sm font-mono text-[#F5F5F7] placeholder:text-[#70737E] outline-none min-w-0"
                    />
                    {payoutAddress && !addressValid && (
                      <span className="text-[10px] font-medium text-[#F87171] bg-[#281313] px-2 py-0.5 rounded-full border border-[#4A2323]">
                        Invalid
                      </span>
                    )}
                  </div>

                  {/* Chain — saved together with the address */}
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[#34343E] bg-[#1B1917] px-3 py-2.5">
                    <span className="text-xs font-medium text-[#70737E]">Chain</span>
                    <select
                      value={chain}
                      onChange={(e) => {
                        setChain(e.target.value);
                        if (addressValid) {
                          persistPayout(payoutAddress.trim(), e.target.value);
                          setIsAddressSaved(true);
                        }
                      }}
                      className="rounded-lg border border-[#34343E] bg-[#15161C] px-2 py-1 text-xs font-bold text-[#F5F5F7] outline-none"
                    >
                      {SUPPORTED_CHAINS.map((supportedChain) => (
                        <option key={supportedChain.id} value={supportedChain.id}>
                          {supportedChain.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-[#70737E] flex-1">
                      {payoutAddress && !addressValid
                        ? 'Enter a valid BSC (BEP-20) wallet address'
                        : isAddressSaved
                          ? 'Saved — every withdrawal is sent to this address'
                          : 'Save this address so every withdrawal goes here'}
                    </p>
                    <button
                      type="button"
                      onClick={handleSavePayout}
                      disabled={!addressValid}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                        isAddressSaved
                          ? 'border-[#123A24] bg-[#10251A] text-[#4ADE80]'
                          : 'border-[#8F4817] bg-[#2A190D] text-[#FF8F3D] hover:bg-[#3A281C]'
                      }`}
                    >
                      {isAddressSaved && <Check size={12} />}
                      {isAddressSaved ? 'Saved' : 'Save Address'}
                    </button>
                  </div>
                </div>

                {/* Withdraw Button */}
                <button
                  onClick={handleWithdraw}
                  disabled={blockReason !== null || isLoading}
                  className="w-full mt-5 py-3 bg-[#FF7A18] text-white font-bold rounded-xl hover:bg-[#FF8F3D] disabled:bg-[#34343E] disabled:opacity-70 disabled:blur-[1px] disabled:cursor-not-allowed transition transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      Processing...
                    </span>
                  ) : isSuccess ? (
                    <span className="flex items-center justify-center gap-2">
                      <Check size={18} /> Completed!
                    </span>
                  ) : (
                    'Request Withdrawal'
                  )}
                </button>

                {/* Status Messages */}
                {status === 'processing' && (
                  <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
                    <p className="text-sm font-semibold text-[#F59E0B]">
                      ⏳ Processing Withdrawal
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      Your withdrawal request has been submitted. TDX will be locked and sent to your wallet after admin approval.
                    </p>
                  </div>
                )}

                {status === 'success' && (
                  <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
                    <p className="text-sm font-semibold text-[#6EE7B7]">
                      ✅ Withdrawal Completed!
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      Payment verified and sent to your wallet.
                    </p>
                  </div>
                )}

                {status === 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
                    <p className="text-sm font-semibold text-[#F87171]">
                      ⛔ Payment Not Done
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      {error || 'The withdrawal payment was not completed.'}
                    </p>
                  </div>
                )}

                {error && status !== 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
                    <p className="text-sm text-[#F87171]">{error}</p>
                  </div>
                )}

                <div className="mt-4 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-[#F59E0B] mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#F59E0B]">
                        Withdrawal Information
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`font-extrabold ${
                          }`}
                        >
                            ? '…'
                              : '—'}
                        </span>
                      </div>
                      <ul className="mt-2 list-disc list-inside space-y-0.5 text-xs text-[#F59E0B]">
                        <li>
                          Min {formatDecimalString(minUsdtRaw)} USDT
                          <span className="mx-1">•</span>
                          Max {formatDecimalString(maxUsdtRaw)} USDT
                        </li>
                        <li>Check the address and network before submitting.</li>
                        <li>Never share your password, OTP, or recovery phrase.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* History Section */}
          {showHistory && accountReady && (
            <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[#F5F5F7]">Withdrawal History</h3>
                <button
                  onClick={() => fetchHistory()}
                  className="text-xs text-[#C99752] hover:text-[#C99752] flex items-center gap-1"
                  disabled={transactionsLoading}
                >
                  {transactionsLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    'Refresh'
                  )}
                </button>
              </div>

              {transactionsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="text-[#C99752] animate-spin" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#A1A4AE]">
                  No withdrawals yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {transactions.map((tx) => {
                    const badge = getStatusBadge(tx.status);
                    return (
                      <div key={tx.id} className="flex items-center justify-between rounded-lg bg-[#1B1917] px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#281313] flex items-center justify-center">
                            <ArrowUpFromLine size={12} className="text-[#F87171]" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#E4E5E8]">Withdrawal</p>
                            <p className="text-[10px] text-[#70737E]">{formatRelativeTime(tx.createdAt)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          {/* ✅ FIX: Use formatAmount for 2 decimal places */}
                          <p className="text-xs font-bold text-[#F87171]">-{formatAmount(tx.amount)} TDX</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}