// frontend/src/components/RecentActivity.tsx

import React, { useMemo } from 'react';
import {
  AlertCircle,
  FileText,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useWalletContext } from '../../wallet/context/WalletContext';
import { useTransactionHistory } from '../../wallet/transactions/hooks/useTransactionHistory';
import type { Transaction } from '../../wallet/transactions/types/transaction.types';

// ============================================================
// CONSTANTS
// ============================================================

const TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  trade: 'Trade',
  game: 'Game',
  other: 'Other',
};

// ============================================================
// HELPERS
// ============================================================

function getAmountSign(tx: Transaction): string {
  if (tx.direction === 'credit') return '+';
  if (tx.direction === 'debit') return '-';
  if (tx.type === 'deposit') return '+';
  if (tx.type === 'withdraw') return '-';
  return '';
}

function formatAmount(value: string | number | null | undefined): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === null || num === undefined || isNaN(num)) return '0.00';
  return num.toFixed(2);
}

function formatRelativeTime(date: string): string {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return '—';

  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStatus(status: string): string {
  if (!status) return 'Pending';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

// ============================================================
// COMPONENT
// ============================================================

export default function RecentActivity() {
  const navigate = useNavigate();
  const { userId, isConnected } = useWalletContext();
  const { transactions, isLoading, error } = useTransactionHistory(userId);

  const recentTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3),
    [transactions]
  );

  const hasSession = !!userId;
  const showConnectState = !isConnected && !hasSession && !isLoading && recentTransactions.length === 0;
  const showEmptyState = hasSession && !isLoading && !error && recentTransactions.length === 0;

  return (
    <div className="min-h-[245px] rounded-[20px] border border-[#E7E9EE] bg-white p-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="text-[19px] font-black text-[#111827]">Recent Activity</h2>
        <button
          onClick={() => navigate('/transactions')}
          className="text-[#F5B800] text-[15px] font-extrabold hover:text-[#F59E0B] transition"
        >
          See All ›
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center pt-[35px]">
          <Loader2 size={28} className="animate-spin text-[#98A2B3]" />
          <div className="mt-3 text-sm font-bold text-[#475467]">Loading activity...</div>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 text-[#B91C1C]" />
            <div>
              <div className="text-xs font-extrabold text-[#991B1B]">Could not load activity</div>
              <p className="mt-0.5 text-xs text-[#7F1D1D]">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Connect State */}
      {showConnectState && (
        <div className="flex flex-col items-center justify-center pt-[35px]">
          <FileText size={58} color="#D0D5DD" />
          <div className="mt-3 text-[17px] font-bold text-[#475467]">Connect wallet to view activity</div>
          <div className="mt-1 text-sm text-[#667085]">Your recent transactions will appear here.</div>
        </div>
      )}

      {/* Empty State */}
      {showEmptyState && (
        <div className="flex flex-col items-center justify-center pt-[35px]">
          <FileText size={58} color="#D0D5DD" />
          <div className="mt-3 text-[17px] font-bold text-[#475467]">No transactions yet</div>
          <div className="mt-1 text-sm text-[#667085]">Your activity will appear here.</div>
        </div>
      )}

      {/* Transactions List */}
      {!isLoading && !error && recentTransactions.length > 0 && (
        <div className="mt-4 space-y-2">
          {recentTransactions.map((tx) => {
            const sign = getAmountSign(tx);
            const label = TYPE_LABELS[tx.type] || tx.type || 'Transaction';
            const amount = formatAmount(tx.amount);
            const status = formatStatus(tx.status);

            return (
              <button
                key={tx.id}
                type="button"
                onClick={() => navigate('/transactions')}
                className="flex w-full items-center justify-between rounded-xl border border-[#E7E9EE] bg-[#FCFCFD] px-3 py-2 text-left hover:bg-white transition"
              >
                <div>
                  <div className="text-xs font-extrabold text-[#111827]">{label}</div>
                  <div className="text-[10px] text-[#667085]">{formatRelativeTime(tx.timestamp)}</div>
                </div>

                <div className="text-right">
                  <div className={`text-xs font-black ${sign === '+' ? 'text-green-600' : sign === '-' ? 'text-red-600' : 'text-[#111827]'}`}>
                    {sign} {amount} {tx.currency || 'TDX'}
                  </div>
                  <div className="text-[10px] font-bold text-[#667085] capitalize">{status}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}