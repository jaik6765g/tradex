// ============================================================
// WALLET DASHBOARD - Complete UI
// ============================================================

import React from 'react';
import { useWalletContext } from '../context/WalletContext';
import { WalletBalance } from './WalletBalance';
import { WalletActions } from './WalletActions';
import { TransactionHistory } from '../transactions/components/TransactionHistory';
import { useTransactionHistory } from '../transactions/hooks/useTransactionHistory';

export function WalletDashboard() {
  const { balance, isLoading, error, refresh, userId } = useWalletContext();

  const {
    transactions,
    isLoading: txLoading,
    hasMore,
    loadMore,
    refresh: refreshTx,
  } = useTransactionHistory(userId);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-500">{error}</p>
        <button onClick={refresh} className="mt-3 text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Balance */}
      <WalletBalance balance={balance} />

      {/* Actions */}
      <WalletActions
        onRefresh={() => {
          refresh();
          refreshTx();
        }}
      />

      {/* Transaction History */}
      <TransactionHistory
        transactions={transactions}
        isLoading={txLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}