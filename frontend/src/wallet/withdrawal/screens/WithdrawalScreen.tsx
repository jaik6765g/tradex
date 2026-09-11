// frontend/src/wallet/withdrawal/screens/WithdrawalScreen.tsx

import React, { useState, useEffect } from 'react';
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
// COMPONENT
// ============================================================

export default function WithdrawalScreen() {
  const {
    address,
    isConnected,
    isAuthenticated,
    userId,
    tdxBalance,
    usdtBalance,
    refresh: refreshWallet,
  } = useWalletContext();

  const [amount, setAmount] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const { withdraw, status, error, isLoading, isSuccess, reset } = useWithdraw(userId);

  const walletReady = Boolean(address && isConnected && isAuthenticated && userId);

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatTDX = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatUSDT = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  // ✅ NEW: Format amount to 2 decimal places
  const formatAmount = (amount: string | number): string => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
  };

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
      pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700' },
      processing: { label: 'Processing', className: 'bg-blue-100 text-blue-700' },
      completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
      failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
      rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
      approved: { label: 'Approved', className: 'bg-blue-100 text-blue-700' },
      cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-700' },
    };
    return map[status] || { label: status, className: 'bg-gray-100 text-gray-700' };
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

  const usdtAmount = amount ? parseFloat(amount) / 100 : 0;

  const handleWithdraw = async () => {
    if (!walletReady || !address) return;
    await withdraw(amount, address);
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
    <div className="min-h-screen bg-[#F8FAFC] pb-24">
      <main className="mx-auto w-full max-w-[500px] px-4 py-5">
        <div className="space-y-4">
          {/* Header */}
          <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#111827] text-white">
                <ArrowUpFromLine size={18} />
              </div>
              <div>
                <h1 className="text-[20px] font-black text-[#111827]">Withdraw</h1>
                <p className="text-xs text-[#667085]">100 TDX = 1 USDT</p>
              </div>
            </div>
          </section>

          {/* Auth Warning */}
          {!walletReady && (
            <section className="rounded-[18px] border border-[#FED7AA] bg-[#FFF7ED] p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert size={20} className="mt-0.5 shrink-0 text-[#C2410C]" />
                <div>
                  <p className="text-sm font-extrabold text-[#9A3412]">Wallet authentication required</p>
                  <p className="mt-1 text-xs text-[#C2410C]">Connect and authenticate your wallet before withdrawing.</p>
                </div>
              </div>
            </section>
          )}

          {/* Withdraw Panel */}
          <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-black text-[#111827]">Withdraw</h2>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
              >
                <History size={14} />
                {showHistory ? 'Hide History' : 'View History'}
              </button>
            </div>

            {walletReady && (
              <>
                {/* Balance Display */}
                <div className="mt-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-500">Available Balance</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {formatTDX(tdxBalance)} <span className="text-sm font-semibold text-gray-500">TDX</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        ≈ {formatUSDT(usdtBalance)} USDT
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Wallet</p>
                      <p className="text-xs font-mono text-gray-600">{formatAddress(address)}</p>
                    </div>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Amount (TDX)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-bold text-gray-900"
                      disabled={isLoading}
                      min="1"
                      step="0.01"
                    />
                    <button
                      onClick={() => {
                        const max = parseFloat(tdxBalance || '0');
                        if (max > 0) setAmount(max.toString());
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-blue-600 hover:text-blue-800"
                    >
                      MAX
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Min: 0.01 TDX • Max: {formatTDX(tdxBalance)} TDX
                  </p>
                </div>

                {/* USDT Preview */}
                {amount && parseFloat(amount) > 0 && (
                  <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-100">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">You will receive:</span>
                      <span className="text-lg font-bold text-green-600">
                        {usdtAmount.toFixed(2)} USDT
                      </span>
                    </div>
                  </div>
                )}

                {/* Destination Wallet */}
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Destination Wallet
                  </label>
                  <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <Wallet size={16} className="text-gray-400" />
                    <span className="flex-1 text-sm font-mono text-gray-700">
                      {formatAddress(address)}
                    </span>
                    <span className="text-[10px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      Connected
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Withdrawals sent to your connected wallet address
                  </p>
                </div>

                {/* Withdraw Button */}
                <button
                  onClick={handleWithdraw}
                  disabled={!amount || parseFloat(amount) <= 0 || isLoading || !walletReady}
                  className="w-full mt-5 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition transform hover:scale-[1.02] active:scale-[0.98]"
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
                  <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
                    <p className="text-sm font-semibold text-yellow-700">
                      ⏳ Processing Withdrawal
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Your withdrawal request has been submitted. TDX will be locked and sent to your wallet after admin approval.
                    </p>
                  </div>
                )}

                {status === 'success' && (
                  <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
                    <p className="text-sm font-semibold text-green-700">
                      ✅ Withdrawal Completed!
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Payment verified and sent to your wallet.
                    </p>
                  </div>
                )}

                {status === 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
                    <p className="text-sm font-semibold text-red-700">
                      ⛔ Payment Not Done
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {error || 'The withdrawal payment was not completed.'}
                    </p>
                  </div>
                )}

                {error && status !== 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* Info */}
                <div className="mt-4 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-yellow-700">
                        Withdrawal Information
                      </p>
                      <ul className="text-xs text-yellow-700 mt-1 space-y-0.5 list-disc list-inside">
                        <li>Minimum: 1 TDX (0.01 USDT)</li>
                        <li>Large withdrawals require admin approval</li>
                        <li>Processing time: 5-30 minutes</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* History Section */}
          {showHistory && walletReady && (
            <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-900">Withdrawal History</h3>
                <button
                  onClick={() => fetchHistory()}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
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
                  <Loader2 size={24} className="text-blue-600 animate-spin" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">
                  No withdrawals yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {transactions.map((tx) => {
                    const badge = getStatusBadge(tx.status);
                    return (
                      <div key={tx.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
                            <ArrowUpFromLine size={12} className="text-red-600" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-800">Withdrawal</p>
                            <p className="text-[10px] text-gray-400">{formatRelativeTime(tx.createdAt)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          {/* ✅ FIX: Use formatAmount for 2 decimal places */}
                          <p className="text-xs font-bold text-red-600">-{formatAmount(tx.amount)} TDX</p>
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