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
      <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
        <p className="text-sm text-yellow-700 font-medium">⏳ Processing...</p>
        <p className="text-xs text-gray-500 mt-1">Your withdrawal is being processed.</p>
        {withdrawalId && (
          <p className="text-xs text-gray-400 break-all mt-1">
            ID: {withdrawalId}
          </p>
        )}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
        <p className="text-sm text-green-700 font-medium">✅ Withdrawal completed successfully.</p>
        {withdrawalId && (
          <p className="text-xs text-gray-500 break-all mt-1">
            ID: {withdrawalId}
          </p>
        )}
      </div>
    );
  }

  if (status === 'paymentNotDone') {
    return (
      <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
        <p className="text-sm text-red-700 font-medium">⛔ Payment Not Done</p>
        <p className="text-xs text-gray-500 mt-1">
          {error || 'The withdrawal payment was not completed.'}
        </p>
      </div>
    );
  }

  if (status === 'error' && error) {
    return (
      <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (status === 'requesting') {
    return (
      <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
        <p className="text-sm text-yellow-700">⏳ Requesting withdrawal...</p>
        <p className="text-xs text-gray-500 mt-1">Please wait</p>
      </div>
    );
  }

  return null;
}