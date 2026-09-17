// ============================================================
// WITHDRAW FORM
// ============================================================

import React from 'react';

interface WithdrawFormProps {
  amount: string;
  setAmount: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  maxBalance: string;
  usdtAmount: number;
}

export function WithdrawForm({
  amount,
  setAmount,
  address,
  setAddress,
  onSubmit,
  isLoading,
  isSuccess,
  maxBalance,
  usdtAmount,
}: WithdrawFormProps) {
  const numericAmount = Number.parseFloat(amount || '0');
  const numericMaxBalance = Number.parseFloat(maxBalance || '0');
  const isAmountInvalid =
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0 ||
    (Number.isFinite(numericMaxBalance) && numericAmount > numericMaxBalance);

  const isAddressInvalid = !address || !address.startsWith('0x') || address.length !== 42;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#A1A4AE] mb-1">Amount (TDX)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full px-4 py-3 border border-[#34343E] rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-lg"
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-[#A1A4AE]">Available: {maxBalance} TDX</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#A1A4AE] mb-1">Destination Wallet Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder="0x..."
          className="w-full px-4 py-3 border border-[#34343E] rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
          disabled={isLoading}
        />
      </div>

      {numericAmount > 0 && (
        <div className="p-4 bg-gradient-to-r from-[#10251A] to-emerald-50 rounded-xl border border-[#123A24]">
          <p className="text-sm text-[#A1A4AE]">You will receive:</p>
          <p className="text-2xl font-bold text-[#4ADE80]">
            {usdtAmount || numericAmount / 100}{' '}
            <span className="text-sm font-normal text-[#A1A4AE]">USDT</span>
          </p>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={isAmountInvalid || isAddressInvalid || isLoading}
        className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-medium rounded-xl hover:from-green-700 hover:to-emerald-700 disabled:from-[#34343E] disabled:to-[#34343E] disabled:cursor-not-allowed transition-all duration-200 shadow-md"
      >
        {isLoading ? '⏳ Processing...' : isSuccess ? '✅ Submitted!' : 'Request Withdrawal'}
      </button>
    </div>
  );
}