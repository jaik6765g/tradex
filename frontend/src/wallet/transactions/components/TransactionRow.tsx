// ============================================================
// TRANSACTION ROW - COMPLETE FIX
// ============================================================

import React from 'react';
import { Transaction } from '../types/transaction.types';

interface TransactionRowProps {
  transaction: Transaction;
}

const statusColors: Record<string, string> = {
  completed: 'bg-[#10251A] text-[#6EE7B7]',
  pending: 'bg-[#2A190D] text-[#F59E0B]',
  processing: 'bg-[#211810] text-[#C99752]',
  verifying: 'bg-[#211810] text-[#C99752]',
  confirmed: 'bg-[#211810] text-[#C99752]',
  approved: 'bg-[#211810] text-[#C99752]',
  failed: 'bg-[#281313] text-[#F87171]',
  rejected: 'bg-[#281313] text-[#F87171]',
  cancelled: 'bg-[#202229] text-[#A1A4AE]',
};

const typeIcons: Record<string, string> = {
  deposit: '💰',
  withdraw: '📤',
  trade: '📈',
  game: '🎮',
  other: '💳',
};

export function TransactionRow({ transaction }: TransactionRowProps) {
  const { type, status, amount, currency, tdxAmount, usdtAmount, timestamp, description } = transaction;

  // ✅ FIX: Proper formatting for each type
  let displayAmount = amount;
  let displayCurrency = currency;
  let subText = '';
  let mainAmount = '';

  if (type === 'deposit') {
    // ✅ Deposit: Show TDX as main, USDT as sub
    displayCurrency = 'TDX';
    displayAmount = tdxAmount || amount;
    mainAmount = `${displayAmount} ${displayCurrency}`;
    subText = usdtAmount ? `${usdtAmount} USDT deposited` : '';
  } else if (type === 'withdraw') {
    // ✅ Withdraw: Show USDT as main, TDX as sub
    displayCurrency = 'USDT';
    displayAmount = amount;
    mainAmount = `${displayAmount} ${displayCurrency}`;
    subText = tdxAmount ? `${tdxAmount} TDX withdrawn` : 'Processing...';
  } else {
    // ✅ Trade/Game: Show TDX
    displayCurrency = 'TDX';
    displayAmount = amount;
    mainAmount = `${displayAmount} ${displayCurrency}`;
  }

  const formattedDate = new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sign = type === 'deposit' ? '+' : type === 'withdraw' ? '-' : '';

  return (
    <div className="flex items-center justify-between p-4 hover:bg-[#1B1917] transition-colors">
      {/* Left: Icon + Info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-xl shrink-0">{typeIcons[type]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[#E4E5E8] capitalize">{type}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[status]}`}>
              {status}
            </span>
          </div>
          <p className="text-xs text-[#A1A4AE]">{formattedDate}</p>
          {description && <p className="text-xs text-[#70737E] mt-0.5 truncate">{description}</p>}
          {subText && <p className="text-xs text-[#70737E]">{subText}</p>}
        </div>
      </div>

      {/* Right: Amount */}
      <div className="text-right shrink-0 ml-4">
        <p className="text-sm font-bold text-[#F5F5F7]">
          {sign} {mainAmount}
        </p>
      </div>
    </div>
  );
}