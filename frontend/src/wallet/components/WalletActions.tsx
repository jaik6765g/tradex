// ============================================================
// WALLET ACTIONS
// ============================================================

import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  onRefresh: () => void;
}

export function WalletActions({ onRefresh }: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        to="/deposit"
        className="px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors flex-1 min-w-[120px] font-medium text-center"
      >
        💰 Deposit
      </Link>
      <Link
        to="/withdraw"
        className="px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors flex-1 min-w-[120px] font-medium text-center"
      >
        📤 Withdraw
      </Link>
      <button
        onClick={onRefresh}
        className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-colors"
      >
        🔄
      </button>
    </div>
  );
}