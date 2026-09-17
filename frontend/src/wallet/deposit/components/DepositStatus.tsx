// ============================================================
// DEPOSIT STATUS - Success/Error/Pending Display
// ============================================================

import React from 'react';
import { DepositStatus as DepositStatusType } from '../types/deposit.types';

interface DepositStatusProps {
  status: DepositStatusType;
  error: string | null;
  txHash: string | null;
}

export function DepositStatus({ status, error, txHash }: DepositStatusProps) {
  if (status === 'processing') {
    return (
      <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
        <p className="text-sm text-[#F59E0B] font-medium">⏳ Processing payment...</p>
        <p className="text-xs text-[#A1A4AE] mt-1">
          Your deposit is being verified. TDX will be credited after blockchain confirmation.
        </p>
        {txHash && (
          <p className="text-xs text-[#70737E] break-all mt-1">
            Tx: {txHash.slice(0, 20)}...
          </p>
        )}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
        <p className="text-sm text-[#6EE7B7] font-medium">✅ Deposit completed successfully.</p>
        <p className="text-xs text-[#A1A4AE] mt-1">TDX has been credited. Your balance will refresh automatically.</p>
        {txHash && (
          <p className="text-xs text-[#A1A4AE] break-all mt-1">
            Tx: {txHash.slice(0, 20)}...
          </p>
        )}
      </div>
    );
  }

  if (status === 'paymentNotDone') {
    return (
      <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
        <p className="text-sm text-[#F87171] font-medium">⛔ Payment Not Done</p>
        <p className="text-xs text-[#A1A4AE] mt-1">
          {error || 'The payment was not completed. No TDX was credited.'}
        </p>
      </div>
    );
  }

  if (status === 'error' && error) {
    return (
      <div className="mt-3 p-3 bg-[#281313] rounded-xl border border-[#4A2323]">
        <p className="text-sm text-[#F87171]">{error}</p>
      </div>
    );
  }

  if (status === 'approving') {
    return (
      <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
        <p className="text-sm text-[#F59E0B]">⏳ Approving USDT...</p>
        <p className="text-xs text-[#A1A4AE] mt-1">Please confirm in your wallet</p>
      </div>
    );
  }

  if (status === 'depositing') {
    return (
      <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
        <p className="text-sm text-[#F59E0B]">⏳ Depositing...</p>
        <p className="text-xs text-[#A1A4AE] mt-1">Please confirm in your wallet</p>
      </div>
    );
  }

  return null;
}