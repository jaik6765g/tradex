// ============================================================
// DEPOSIT FORM
// ============================================================

import React from 'react';
import { MIN_USDT_DEPOSIT, TDX_RATE } from '../../config/wallet';
import { useWalletLimits } from '../../hooks/useWalletLimits';
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
  // Supplementary validation only — the backend enforces every limit.
  const { depositMin, depositMax } = useWalletLimits();
  const minDeposit = Number.isFinite(depositMin) ? depositMin : MIN_USDT_DEPOSIT;
  const aboveMaximum = Number.isFinite(amountNumber) && amountNumber > depositMax;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#A1A4AE] mb-1">
          Amount (USDT)
        </label>
        <input
          type="number"
          min={minDeposit}
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full px-4 py-3 border border-[#34343E] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF7A18] focus:border-transparent text-lg"
          disabled={isLoading}
        />
      </div>

      <p className="text-xs text-[#A1A4AE]">
        Minimum deposit: {minDeposit} USDT · Maximum per transaction: {depositMax} USDT
      </p>
      {aboveMaximum && (
        <p className="text-xs text-[#F87171]">
          Maximum deposit per transaction is {depositMax} USDT.
        </p>
      )}

      {amount && hasValidAmount && (
        <div className="p-4 bg-gradient-to-r from-[#211810] to-[#211810] rounded-xl border border-[#34261C]">
          <p className="text-sm text-[#A1A4AE]">You will receive:</p>
          <p className="text-2xl font-bold text-[#C99752]">
            {tdxAmount || amountNumber * TDX_RATE}{' '}
            <span className="text-sm font-normal text-[#A1A4AE]">TDX</span>
          </p>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!hasValidAmount || amountNumber < minDeposit || aboveMaximum || isLoading}
        className="w-full py-3 px-4 bg-gradient-to-r from-[#FF7A18] to-[#E8650F] text-white font-medium rounded-xl hover:from-[#FF8F3D] hover:to-[#D2570E] disabled:from-[#34343E] disabled:to-[#34343E] disabled:cursor-not-allowed transition-all duration-200 shadow-md"
      >
        {isLoading ? '⏳ Processing...' : isSuccess ? '✅ Done!' : 'Deposit USDT'}
      </button>

      {isLoading && (
        <p className="text-xs text-[#A1A4AE] text-center">
          {status === 'approving' ? 'Approving USDT (one-time)...' : 'Depositing USDT...'}
        </p>
      )}
    </div>
  );
}