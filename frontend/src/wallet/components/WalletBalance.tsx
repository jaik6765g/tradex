// ============================================================
// WALLET BALANCE
// ============================================================

import React from 'react';
import { WalletBalance as IWalletBalance } from '../types/wallet.types';

interface Props {
  balance: IWalletBalance;
}

export function WalletBalance({ balance }: Props) {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg">
      <p className="text-sm opacity-80">Total Balance</p>
      <p className="text-3xl font-bold mt-1">{balance.tdx} TDX</p>
      
      <div className="flex gap-6 mt-4 pt-4 border-t border-white/20">
        <div>
          <p className="text-xs opacity-80">USDT</p>
          <p className="text-lg font-semibold">{balance.usdt}</p>
        </div>
        <div>
          <p className="text-xs opacity-80">{balance.nativeSymbol}</p>
          <p className="text-lg font-semibold">{balance.native}</p>
        </div>
      </div>
    </div>
  );
}