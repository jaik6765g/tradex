// ============================================================
// WITHDRAWAL STATUS
// ============================================================

import React from 'react';
import { WithdrawStatus } from '../types/withdrawal.types';

interface WithdrawalStatusProps {
  status: WithdrawStatus;
  error: string | null;
  withdrawalId: string | null;
}

export function WithdrawalStatus({ status, error, withdrawalId }: WithdrawalStatusProps) {
  if (status === 'processing') {
    return (
      <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
        <p className="text-sm text-[#F59E0B] font-medium">⏳ Processing...</p>
        <p className="text-xs text-[#A1A4AE] mt-1">Your withdrawal is being processed.</p>
        {withdrawalId && (
          <p className="text-xs text-[#70737E] break-all mt-1">
            ID: {withdrawalId}
          </p>
        )}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="mt-3 p-3 bg-[#10251A] rounded-xl border border-[#123A24]">
        <p className="text-sm text-[#6EE7B7] font-medium">✅ Withdrawal completed successfully.</p>
        {withdrawalId && (
          <p className="text-xs text-[#A1A4AE] break-all mt-1">
            ID: {withdrawalId}
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
          {error || 'The withdrawal payment was not completed.'}
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

  if (status === 'requesting') {
    return (
      <div className="mt-3 p-3 bg-[#2A190D] rounded-xl border border-[#3A281C]">
        <p className="text-sm text-[#F59E0B]">⏳ Requesting withdrawal...</p>
        <p className="text-xs text-[#A1A4AE] mt-1">Please wait</p>
      </div>
    );
  }

  return null;
}