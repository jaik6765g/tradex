// ============================================================
// DEPOSIT FORM
// ============================================================

import React from 'react';
import { MIN_USDT_DEPOSIT, TDX_RATE } from '../../config/wallet';
import type { DepositStatus } from '../types/deposit.types';

interface DepositFormProps {
  amount: string;
  setAmount: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  status: DepositStatus;
  tdxAmount: number;
}

export function DepositForm({
  amount,
  setAmount,
  onSubmit,
  isLoading,
  isSuccess,
  status,
  tdxAmount,
}: DepositFormProps) {
  const amountNumber = Number(amount);
  const hasValidAmount = Number.isFinite(amountNumber) && amountNumber > 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Amount (USDT)
        </label>
        <input
          type="number"
          min={MIN_USDT_DEPOSIT}
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
          disabled={isLoading}
        />
      </div>

      <p className="text-xs text-gray-500">Minimum deposit: {MIN_USDT_DEPOSIT} USDT</p>

      {amount && hasValidAmount && (
        <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
          <p className="text-sm text-gray-600">You will receive:</p>
          <p className="text-2xl font-bold text-blue-600">
            {tdxAmount || amountNumber * TDX_RATE}{' '}
            <span className="text-sm font-normal text-gray-500">TDX</span>
          </p>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!hasValidAmount || amountNumber < MIN_USDT_DEPOSIT || isLoading}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all duration-200 shadow-md"
      >
        {isLoading ? '⏳ Processing...' : isSuccess ? '✅ Done!' : 'Deposit USDT'}
      </button>

      {isLoading && (
        <p className="text-xs text-gray-500 text-center">
          {status === 'approving' ? 'Approving USDT (one-time)...' : 'Depositing USDT...'}
        </p>
      )}
    </div>
  );
}