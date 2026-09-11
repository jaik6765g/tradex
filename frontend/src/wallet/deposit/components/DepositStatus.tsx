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
      <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
        <p className="text-sm text-yellow-700 font-medium">⏳ Processing payment...</p>
        <p className="text-xs text-gray-500 mt-1">
          Your deposit is being verified. TDX will be credited after blockchain confirmation.
        </p>
        {txHash && (
          <p className="text-xs text-gray-400 break-all mt-1">
            Tx: {txHash.slice(0, 20)}...
          </p>
        )}
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
        <p className="text-sm text-green-700 font-medium">✅ Deposit completed successfully.</p>
        <p className="text-xs text-gray-500 mt-1">TDX has been credited. Your balance will refresh automatically.</p>
        {txHash && (
          <p className="text-xs text-gray-500 break-all mt-1">
            Tx: {txHash.slice(0, 20)}...
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
          {error || 'The payment was not completed. No TDX was credited.'}
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

  if (status === 'approving') {
    return (
      <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
        <p className="text-sm text-yellow-700">⏳ Approving USDT...</p>
        <p className="text-xs text-gray-500 mt-1">Please confirm in your wallet</p>
      </div>
    );
  }

  if (status === 'depositing') {
    return (
      <div className="mt-3 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
        <p className="text-sm text-yellow-700">⏳ Depositing...</p>
        <p className="text-xs text-gray-500 mt-1">Please confirm in your wallet</p>
      </div>
    );
  }

  return null;
}