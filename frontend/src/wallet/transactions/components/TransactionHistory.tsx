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
      <div className="bg-[#15161C] rounded-2xl p-6 shadow-sm border border-[#292B33]">
        <h3 className="font-medium text-[#A1A4AE] mb-2">Transaction History</h3>
        <p className="text-sm text-[#A1A4AE] text-center py-6">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="bg-[#15161C] rounded-2xl shadow-sm border border-[#292B33] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#292B33] flex items-center justify-between">
        <h3 className="font-medium text-[#A1A4AE]">Transaction History</h3>
        <span className="text-xs text-[#70737E]">{transactions.length} transactions</span>
      </div>

      {/* List */}
      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {transactions.map((tx) => (
          <TransactionRow key={tx.id} transaction={tx} />
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="p-3 text-center border-t border-[#292B33]">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="text-sm text-[#C99752] hover:text-[#C99752] disabled:text-[#70737E] transition"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#FF7A18] border-t-transparent rounded-full animate-spin" />
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