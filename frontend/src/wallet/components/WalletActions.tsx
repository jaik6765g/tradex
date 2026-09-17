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
        className="px-6 py-2.5 bg-[#FF7A18] text-white rounded-xl hover:bg-[#FF8F3D] transition-colors flex-1 min-w-[120px] font-medium text-center"
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
        className="px-4 py-2.5 bg-[#34343E] text-[#A1A4AE] rounded-xl hover:bg-[#34343E] transition-colors"
      >
        🔄
      </button>
    </div>
  );
}