// frontend/src/wallet/deposit/screens/DepositScreen.tsx

import React, { useState, useEffect } from 'react';
import {
  Check,
  ShieldAlert,
  Loader2,
  FileText,
  RefreshCw,
  Plus,
  AlertTriangle,
  ArrowDownToLine,
  History,
  Wallet,
} from 'lucide-react';
import { useWalletContext } from '../../../wallet/context/WalletContext';
import { useDeposit } from '../hooks/useDeposit';
import { useDeposits } from '../hooks/useDeposits';
import { DepositForm } from '../components/DepositForm';
import { DepositStatus } from '../components/DepositStatus';

// ============================================================
// TYPES
// ============================================================

interface Deposit {
  id: string;
  usdtAmount: number;
  tdxAmount: number;
  status: string;
  transactionHash: string;
  createdAt: string;
}

// ============================================================
// COMPONENT
// ============================================================

export default function DepositScreen() {
  const {
    address,
    isConnected,
    isAuthenticated,
    userId,
    usdtBalance,
    refresh: refreshWallet,
  } = useWalletContext();

  const [amount, setAmount] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const {
    deposit,
    reset: resetDeposit,
    status,
    error: depositError,
    txHash,
    tdxAmount,
    isLoading,
    isSuccess,
  } = useDeposit(userId);

  const {
    deposits,
    loading: historyLoading,
    error: historyError,
    isUnauthenticated,
    refresh,
  } = useDeposits(userId);

  const walletReady = Boolean(address && isConnected && isAuthenticated && userId);

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatUSDT = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatTDX = (v: string | number) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '0.00' : n.toFixed(2);
  };

  const formatAmount = (amount: string | number): string => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
  };

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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
      pending: { label: 'Pending', className: 'bg-[#2A190D] text-[#F59E0B]' },
      confirming: { label: 'Confirming', className: 'bg-[#211810] text-[#C99752]' },
      verified: { label: 'Verified', className: 'bg-[#211810] text-[#C99752]' },
      completed: { label: 'Completed', className: 'bg-[#10251A] text-[#6EE7B7]' },
      failed: { label: 'Failed', className: 'bg-[#281313] text-[#F87171]' },
    };
    return map[status?.toLowerCase()] || { label: status || 'Unknown', className: 'bg-[#202229] text-[#A1A4AE]' };
  };

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleDeposit = async () => {
    if (!walletReady || !amount.trim()) return;
    await deposit(amount);
  };

  const handleReset = () => {
    setAmount('');
    resetDeposit();
  };

  useEffect(() => {
    if (isSuccess) {
      void refresh();
      void refreshWallet();
    }
  }, [isSuccess, refresh, refreshWallet]);

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
                <ArrowDownToLine size={18} />
              </div>
              <div>
                <h1 className="text-[20px] font-black text-[#F5F5F7]">Deposit</h1>
                <p className="text-xs text-[#A1A4AE]">Add USDT to your TradeX wallet</p>
              </div>
            </div>
          </section>

          {/* Auth Warning */}
          {!walletReady && (
            <section className="rounded-[18px] border border-[#3A281C] bg-[#2A1608] p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert size={20} className="mt-0.5 shrink-0 text-[#FDBA74]" />
                <div>
                  <p className="text-sm font-extrabold text-[#FDBA74]">Wallet authentication required</p>
                  <p className="mt-1 text-xs text-[#FDBA74]">Connect and authenticate your wallet before making a deposit.</p>
                </div>
              </div>
            </section>
          )}

          {/* Deposit Panel */}
          <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-black text-[#F5F5F7]">Deposit USDT</h2>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#C99752] hover:text-[#C99752] transition"
              >
                <History size={14} />
                {showHistory ? 'Hide History' : 'View History'}
              </button>
            </div>

            {walletReady && (
              <>
                {/* Balance Display */}
                <div className="mt-4 rounded-xl bg-gradient-to-br from-[#211810] to-[#211810] border border-[#34261C] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#A1A4AE]">Available Balance</p>
                      <p className="text-2xl font-bold text-[#F5F5F7] mt-1">
                        {formatUSDT(usdtBalance)} <span className="text-sm font-semibold text-[#A1A4AE]">USDT</span>
                      </p>
                      <p className="text-xs text-[#70737E] mt-0.5">
                        ≈ {formatTDX(usdtBalance)} TDX
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-medium text-[#70737E] uppercase tracking-wider">Wallet</p>
                      <p className="text-xs font-mono text-[#A1A4AE]">{formatAddress(address)}</p>
                    </div>
                  </div>
                </div>

                {/* Amount Input */}
                <div className="mt-4">
                  <label className="block text-sm font-semibold text-[#A1A4AE] mb-1">
                    Amount (USDT)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-3 border border-[#34343E] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF7A18] focus:border-transparent text-lg font-bold text-[#F5F5F7]"
                      disabled={isLoading}
                      min="0.01"
                      step="0.01"
                    />
                    <button
                      onClick={() => {
                        const max = parseFloat(usdtBalance || '0');
                        if (max > 0) setAmount(max.toString());
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#C99752] hover:text-[#C99752]"
                    >
                      MAX
                    </button>
                  </div>
                  <p className="text-xs text-[#70737E] mt-1">
                    Min: 0.01 USDT • Max: {formatUSDT(usdtBalance)} USDT
                  </p>
                </div>

                {/* TDX Preview */}
                {amount && parseFloat(amount) > 0 && (
                  <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#A1A4AE]">You will receive:</span>
                      <span className="text-lg font-bold text-[#4ADE80]">
                        {formatTDX(parseFloat(amount) * 100)} TDX
                      </span>
                    </div>
                  </div>
                )}

                {/* Deposit Button */}
                <button
                  onClick={handleDeposit}
                  disabled={!amount || parseFloat(amount) <= 0 || isLoading || !walletReady}
                  className="w-full mt-5 py-3 bg-[#FF7A18] text-white font-bold rounded-xl hover:bg-[#FF8F3D] disabled:bg-[#34343E] disabled:cursor-not-allowed transition transform hover:scale-[1.02] active:scale-[0.98]"
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
                    'Deposit USDT'
                  )}
                </button>

                {/* Status Messages */}
                {status === 'processing' && (
                  <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
                    <p className="text-sm font-semibold text-[#F59E0B]">
                      ⏳ Processing Deposit
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      Your deposit is being verified. TDX will be credited after blockchain confirmation.
                    </p>
                  </div>
                )}

                {status === 'success' && (
                  <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
                    <p className="text-sm font-semibold text-[#6EE7B7]">
                      ✅ Deposit Completed!
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      TDX has been credited to your wallet.
                    </p>
                  </div>
                )}

                {status === 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
                    <p className="text-sm font-semibold text-[#F87171]">
                      ⛔ Payment Not Done
                    </p>
                    <p className="text-xs text-[#A1A4AE] mt-1">
                      {depositError || 'The deposit payment was not completed.'}
                    </p>
                  </div>
                )}

                {depositError && status !== 'paymentNotDone' && (
                  <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
                    <p className="text-sm text-[#F87171]">{depositError}</p>
                  </div>
                )}

                {/* Info */}
                <div className="mt-4 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-[#F59E0B] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[#F59E0B]">
                        Deposit Information
                      </p>
                      <ul className="text-xs text-[#F59E0B] mt-1 space-y-0.5 list-disc list-inside">
                        <li>Rate: 1 USDT = 100 TDX</li>
                        <li>Minimum: 1 USDT</li>
                        <li>Processing time: 1-5 minutes</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* History Section */}
          {showHistory && walletReady && (
            <section className="rounded-[20px] border border-[#292B33] bg-[#15161C] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[#F5F5F7]">Deposit History</h3>
                <button
                  onClick={() => void refresh()}
                  className="text-xs text-[#C99752] hover:text-[#C99752] flex items-center gap-1"
                  disabled={historyLoading}
                >
                  {historyLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    'Refresh'
                  )}
                </button>
              </div>

              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={24} className="text-[#C99752] animate-spin" />
                </div>
              ) : isUnauthenticated ? (
                <div className="text-center py-8 text-xs text-red-500">
                  Authentication required to view history
                </div>
              ) : deposits.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#A1A4AE]">
                  No deposits yet
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {deposits.map((deposit: Deposit) => {
                    const badge = getStatusBadge(deposit.status);
                    return (
                      <div key={deposit.id} className="flex items-center justify-between rounded-lg bg-[#1B1917] px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#10251A] flex items-center justify-center">
                            <ArrowDownToLine size={12} className="text-[#4ADE80]" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-[#E4E5E8]">Deposit</p>
                            <p className="text-[10px] text-[#70737E]">{formatRelativeTime(deposit.createdAt)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-[#4ADE80]">+{formatAmount(deposit.tdxAmount)} TDX</p>
                          <p className="text-[10px] text-[#70737E]">{formatAmount(deposit.usdtAmount)} USDT</p>
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