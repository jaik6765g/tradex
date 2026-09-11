// ============================================================
// TRANSACTION HISTORY
// ============================================================

import React from 'react';
import { Transaction } from '../types/transaction.types';
import { TransactionRow } from './TransactionRow';

interface TransactionHistoryProps {
  transactions: Transaction[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function TransactionHistory({
  transactions,
  isLoading,
  hasMore,
  onLoadMore,
}: TransactionHistoryProps) {
  // Empty state
  if (transactions.length === 0 && !isLoading) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="font-medium text-gray-700 mb-2">Transaction History</h3>
        <p className="text-sm text-gray-500 text-center py-6">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-medium text-gray-700">Transaction History</h3>
        <span className="text-xs text-gray-400">{transactions.length} transactions</span>
      </div>

      {/* List */}
      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {transactions.map((tx) => (
          <TransactionRow key={tx.id} transaction={tx} />
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="p-3 text-center border-t border-gray-100">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400 transition"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Loading...
              </span>
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}
    </div>
  );
}