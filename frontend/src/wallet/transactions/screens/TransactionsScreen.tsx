// frontend/src/wallet/transactions/screens/TransactionsScreen.tsx

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  FileText,
  Loader2,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Wallet,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  Gamepad2,
  Gift,
} from 'lucide-react';
import { useWalletContext } from '../../../wallet/context/WalletContext';
import { TransactionService } from '../services/transaction.service';
import { formatTokenAmount } from '../../services/wallet.service';

// ============================================================
// TYPES
// ============================================================

type TransactionType = 'deposit' | 'withdraw' | 'trade' | 'game' | 'bonus' | 'other';
type TransactionStatus = 
  | 'pending' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'rejected' 
  | 'approved' 
  | 'cancelled'
  | 'verifying'
  | 'confirmed';

interface Transaction {
  id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  status: TransactionStatus;
  timestamp: string;
  txHash?: string;
  usdtAmount?: string;
  tdxAmount?: string;
  description?: string;
  direction?: 'credit' | 'debit';
  walletAddress?: string;
  chainId?: number;
  rejectionReason?: string;
  failureReason?: string;
}

// ============================================================
// COMPONENT
// ============================================================

export default function TransactionsScreen() {
  const { userId, isConnected, address } = useWalletContext();
  const [filterType, setFilterType] = useState<'all' | 'deposit' | 'withdraw' | 'bonus'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | TransactionStatus>('all');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // ============================================================
  // FORMAT HELPERS
  // ============================================================

  const formatAddress = (addr: string | null | undefined) => {
    if (!addr) return '---';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatAmount = (amount: string | number | null | undefined): string =>
    formatTokenAmount(amount, 2);

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

  // ============================================================
  // STATUS BADGE
  // ============================================================

  const getStatusBadge = (status: TransactionStatus) => {
    const map: Record<TransactionStatus, { label: string; className: string; icon: React.ReactNode }> = {
      pending: {
        label: 'Pending',
        className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
        icon: <Clock size={12} className="text-yellow-600" />,
      },
      processing: {
        label: 'Processing',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <Clock size={12} className="text-blue-600" />,
      },
      verifying: {
        label: 'Verifying',
        className: 'bg-purple-100 text-purple-700 border-purple-200',
        icon: <Clock size={12} className="text-purple-600" />,
      },
      confirmed: {
        label: 'Confirmed',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <CheckCircle size={12} className="text-blue-600" />,
      },
      approved: {
        label: 'Approved',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <CheckCircle size={12} className="text-blue-600" />,
      },
      completed: {
        label: 'Completed',
        className: 'bg-green-100 text-green-700 border-green-200',
        icon: <CheckCircle size={12} className="text-green-600" />,
      },
      failed: {
        label: 'Failed',
        className: 'bg-red-100 text-red-700 border-red-200',
        icon: <XCircle size={12} className="text-red-600" />,
      },
      rejected: {
        label: 'Rejected',
        className: 'bg-red-100 text-red-700 border-red-200',
        icon: <XCircle size={12} className="text-red-600" />,
      },
      cancelled: {
        label: 'Cancelled',
        className: 'bg-gray-100 text-gray-700 border-gray-200',
        icon: <AlertCircle size={12} className="text-gray-600" />,
      },
    };
    return map[status] || {
      label: status || 'Unknown',
      className: 'bg-gray-100 text-gray-700 border-gray-200',
      icon: <AlertCircle size={12} className="text-gray-600" />,
    };
  };

  const getTypeIcon = (type: TransactionType) => {
    const map: Record<TransactionType, { icon: React.ReactNode; className: string; label: string }> = {
      deposit: {
        icon: <ArrowDownToLine size={14} className="text-green-600" />,
        className: 'bg-green-100',
        label: 'Deposit',
      },
      withdraw: {
        icon: <ArrowUpFromLine size={14} className="text-red-600" />,
        className: 'bg-red-100',
        label: 'Withdrawal',
      },
      trade: {
        icon: <History size={14} className="text-blue-600" />,
        className: 'bg-blue-100',
        label: 'Trade',
      },
      game: {
        icon: <Gamepad2 size={14} className="text-purple-600" />,
        className: 'bg-purple-100',
        label: 'Game',
      },
      bonus: {
        icon: <Gift size={14} className="text-violet-600" />,
        className: 'bg-violet-100',
        label: 'Bonus',
      },
      other: {
        icon: <Wallet size={14} className="text-gray-600" />,
        className: 'bg-gray-100',
        label: 'Other',
      },
    };
    return map[type] || {
      icon: <Wallet size={14} className="text-gray-600" />,
      className: 'bg-gray-100',
      label: 'Unknown',
    };
  };

  // ============================================================
  // ✅ FETCH TRANSACTIONS
  // ------------------------------------------------------------
  // Transactions flow through the shared stack:
  //   TransactionsScreen → TransactionService → WalletService →
  //   apiClient → GET /ledger/me?limit=&offset=
  // No raw deposit/withdrawal endpoints are called here.
  // ============================================================

  const fetchTransactions = useCallback(
    async (reset?: boolean) => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      const currentOffset = reset ? 0 : offset;
      if (reset) setOffset(0);
      setIsLoading(true);
      setError(null);

      try {
        const { items, total: nextTotal, hasMore } =
          await TransactionService.getTransactions(userId, limit, currentOffset);

        const incoming = [...items].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );

        if (reset) {
          setTransactions(incoming);
        } else {
          setTransactions((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            return [...prev, ...incoming.filter((t) => !seen.has(t.id))];
          });
        }

        setTotal(nextTotal);
        setHasMore(hasMore);
        setOffset(currentOffset + incoming.length);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
        setError(err instanceof Error ? err.message : 'Failed to load transactions');
      } finally {
        setIsLoading(false);
      }
    },
    [userId, limit, offset],
  );

  useEffect(() => {
    if (isConnected && userId) {
      fetchTransactions(true);
    } else {
      setIsLoading(false);
      setTransactions([]);
      setTotal(0);
      setHasMore(false);
    }
  }, [isConnected, userId]);

  const refresh = () => {
    fetchTransactions(true);
  };

  const loadMore = () => {
    if (!isLoading && hasMore) {
      fetchTransactions(false);
    }
  };

  // ============================================================
  // FILTER LOGIC
  // ============================================================

  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];

    if (filterType !== 'all') {
      filtered = filtered.filter((tx) => tx.type === filterType);
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter((tx) => tx.status === filterStatus);
    }

    return filtered.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [transactions, filterType, filterStatus]);

  const showConnectState = !isConnected && !isLoading && filteredTransactions.length === 0;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-28">
      <main className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <div className="space-y-4">
          {/* Header */}
          <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[21px] font-black text-[#111827]">Transactions</h1>
                <p className="mt-1 text-xs text-[#64748B]">
                  Your latest wallet activity across deposits, withdrawals, trades, and games.
                </p>
                {isConnected && address && (
                  <p className="mt-1 text-[10px] font-mono text-[#98A2B3]">
                    {formatAddress(address)}
                  </p>
                )}
                {total > 0 && (
                  <p className="mt-1 text-[10px] text-[#667085]">
                    {total} total transaction{total > 1 ? 's' : ''}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={refresh}
                disabled={isLoading}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#E4E7EC] px-3 text-xs font-extrabold text-[#475467] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </section>

          {/* Filters */}
          {isConnected && !isLoading && filteredTransactions.length > 0 && (
            <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Filter size={14} className="text-[#98A2B3] mr-1" />
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filterType === 'all'
                      ? 'bg-[#111827] text-white'
                      : 'bg-[#F8FAFC] text-[#475467] hover:bg-[#F1F5F9]'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterType('deposit')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filterType === 'deposit'
                      ? 'bg-green-600 text-white'
                      : 'bg-[#F8FAFC] text-[#475467] hover:bg-[#F1F5F9]'
                  }`}
                >
                  <ArrowDownToLine size={12} className="inline mr-1" />
                  Deposits
                </button>
                <button
                  onClick={() => setFilterType('withdraw')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filterType === 'withdraw'
                      ? 'bg-red-600 text-white'
                      : 'bg-[#F8FAFC] text-[#475467] hover:bg-[#F1F5F9]'
                  }`}
                >
                  <ArrowUpFromLine size={12} className="inline mr-1" />
                  Withdrawals
                </button>
                <button
                  onClick={() => setFilterType('bonus')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    filterType === 'bonus'
                      ? 'bg-violet-600 text-white'
                      : 'bg-[#F8FAFC] text-[#475467] hover:bg-[#F1F5F9]'
                  }`}
                >
                  <Gift size={12} className="inline mr-1" />
                  Bonus
                </button>

                <div className="w-px h-6 bg-[#E4E7EC] mx-1" />

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as 'all' | TransactionStatus)}
                  className="rounded-lg border border-[#E4E7EC] bg-[#F8FAFC] px-2 py-1.5 text-xs font-medium text-[#475467] outline-none focus:ring-2 focus:ring-[#111827]"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="approved">Approved</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </section>
          )}

          {/* Connect Wallet State */}
          {showConnectState && (
            <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <Wallet size={48} className="text-[#D0D5DD]" />
                <div className="mt-3 text-base font-bold text-[#475467]">
                  Connect your wallet
                </div>
                <div className="mt-1 text-xs text-[#667085]">
                  Connect your wallet to view your transaction history.
                </div>
              </div>
            </section>
          )}

          {/* Loading State */}
          {!showConnectState && isLoading && filteredTransactions.length === 0 && (
            <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <Loader2 size={34} className="animate-spin text-[#475467]" />
                <div className="mt-3 text-sm font-bold text-[#344054]">
                  Loading transactions...
                </div>
              </div>
            </section>
          )}

          {/* Error State */}
          {!showConnectState && !isLoading && error && (
            <section className="rounded-[20px] border border-[#FECACA] bg-[#FEF2F2] p-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 text-[#B91C1C]" />
                <div>
                  <div className="text-sm font-extrabold text-[#991B1B]">
                    Failed to load transactions
                  </div>
                  <p className="mt-1 text-xs text-[#7F1D1D]">{error}</p>
                </div>
              </div>
            </section>
          )}

          {/* Empty State */}
          {!showConnectState && !isLoading && !error && filteredTransactions.length === 0 && (
            <section className="rounded-[20px] border border-[#E5E7EB] bg-white p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <FileText size={42} className="text-[#D0D5DD]" />
                <div className="mt-3 text-base font-bold text-[#475467]">
                  No transactions found
                </div>
                <div className="mt-1 text-xs text-[#667085]">
                  {filterType !== 'all' || filterStatus !== 'all'
                    ? 'Try changing your filters'
                    : 'Your wallet activity will appear here.'}
                </div>
              </div>
            </section>
          )}

          {/* Transactions List */}
          {!showConnectState && filteredTransactions.length > 0 && (
            <section className="overflow-hidden rounded-[20px] border border-[#E5E7EB] bg-white">
              <div className="divide-y divide-[#F2F4F7]">
                {filteredTransactions.map((transaction) => {
                  const statusBadge = getStatusBadge(transaction.status);
                  const typeIcon = getTypeIcon(transaction.type);
                  const isPositive = transaction.direction
                    ? transaction.direction === 'credit'
                    : transaction.type === 'deposit' || transaction.type === 'bonus';

                  return (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                      onClick={() => {
                        // Toggle selection
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${typeIcon.className}`}>
                          {typeIcon.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-bold text-[#111827] capitalize">
                              {typeIcon.label}
                            </p>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${statusBadge.className}`}>
                              {statusBadge.icon}
                              {statusBadge.label}
                            </span>
                          </div>
                          {transaction.txHash && (
                            <p className="text-[10px] text-[#98A2B3] font-mono mt-0.5">
                              {transaction.txHash.slice(0, 10)}...{transaction.txHash.slice(-6)}
                            </p>
                          )}
                          <p className="text-[10px] text-[#98A2B3] mt-0.5">
                            {formatRelativeTime(transaction.timestamp)}
                          </p>
                          {transaction.rejectionReason && transaction.status === 'rejected' && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              Reason: {transaction.rejectionReason}
                            </p>
                          )}
                          {transaction.failureReason && transaction.status === 'failed' && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              Reason: {transaction.failureReason}
                            </p>
                          )}
                          {transaction.type === 'bonus' && (
                            <p className="mt-1 max-w-[260px] whitespace-normal break-words rounded-md bg-violet-50 px-2 py-1 text-[10px] font-medium text-[#475467]">
                              {transaction.description?.replace(/^admin bonus:\s*/i, '').trim() || ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-xs font-bold ${
                            isPositive ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {isPositive ? '+' : '-'}
                          {formatAmount(transaction.tdxAmount || transaction.amount || '0')} TDX
                        </p>
                        {transaction.usdtAmount && (
                          <p className="text-[10px] text-[#98A2B3]">
                            {formatAmount(transaction.usdtAmount)} USDT
                          </p>
                        )}
                        {transaction.walletAddress && (
                          <p className="text-[10px] text-[#98A2B3] font-mono mt-0.5">
                            {formatAddress(transaction.walletAddress)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div className="border-t border-[#F2F4F7] p-3 text-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={isLoading}
                    className="text-xs font-bold text-[#2563EB] hover:text-[#1D4ED8] disabled:cursor-not-allowed disabled:text-[#98A2B3] transition"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 size={12} className="animate-spin" />
                        Loading...
                      </span>
                    ) : (
                      'Load More'
                    )}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Total Count */}
          {!showConnectState && filteredTransactions.length > 0 && (
            <div className="text-center text-[10px] text-[#98A2B3]">
              Showing {filteredTransactions.length} transaction{filteredTransactions.length > 1 ? 's' : ''}
              {total > 0 && ` of ${total}`}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}