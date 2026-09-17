// ============================================================
// DEPOSIT MODAL - Centered Status Popup
// ============================================================
//
// Success is ONLY shown after the BACKEND confirms the deposit and
// credits TDX (status COMPLETED). Form views remain for
// idle / approving / depositing; status popup views are used for
// processing / success / paymentNotDone / error.
// ============================================================

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useDeposit } from '../hooks/useDeposit';
import { DepositForm } from './DepositForm';
import { DepositStatus } from './DepositStatus';
import {
  TransactionStatusView,
  type TransactionStatusKind,
} from '../../components/TransactionStatusPopup';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSuccess?: (result: { usdtAmount: number; tdxAmount: number }) => void;
}

export function DepositModal({ isOpen, onClose, userId, onSuccess }: DepositModalProps) {
  const [amount, setAmount] = useState('');
  const { deposit, status, error, txHash, isLoading, isSuccess, usdtAmount, tdxAmount, reset } = useDeposit(
    userId,
    (result) => {
      onSuccess?.({ usdtAmount: result.usdtAmount!, tdxAmount: result.tdxAmount! });
    }
  );

  if (!isOpen) return null;

  const handleDeposit = async () => {
    await deposit(amount);
  };

  const isFormView =
    status === 'idle' ||
    status === 'approving' ||
    status === 'depositing';

  const isStatusView =
    status === 'processing' ||
    status === 'success' ||
    status === 'paymentNotDone' ||
    status === 'error';

  const closeDisabled = status === 'approving' || status === 'depositing';

  const amountLabel =
    usdtAmount > 0
      ? `${usdtAmount} USDT${tdxAmount > 0 ? ` (${tdxAmount} TDX)` : ''}`
      : undefined;

  const statusKind: TransactionStatusKind =
    status === 'success'
      ? 'success'
      : status === 'paymentNotDone'
        ? 'paymentNotDone'
        : status === 'error'
          ? 'error'
          : 'processing';

  const statusDescription =
    status === 'processing'
      ? 'Your deposit is being verified. TDX will be credited after blockchain confirmation.'
      : status === 'success'
        ? 'Deposit completed successfully. TDX has been credited.'
        : status === 'paymentNotDone'
          ? 'The payment was not completed. No TDX was credited.'
          : error ?? 'Deposit failed. Please try again.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[20px] border border-[#292B33] bg-[#15161C] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.25)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black text-[#F5F5F7]">💰 Deposit USDT</h2>
            <p className="text-xs text-[#A1A4AE]">1 USDT = 100 TDX</p>
          </div>
          <button
            onClick={onClose}
            disabled={closeDisabled}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#292B33] text-[#A1A4AE] hover:bg-[#15161C] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="mt-4">
          {isFormView && (
            <>
              <DepositForm
                amount={amount}
                setAmount={setAmount}
                onSubmit={handleDeposit}
                isLoading={isLoading}
                isSuccess={isSuccess}
                status={status}
                tdxAmount={tdxAmount}
              />
              <DepositStatus status={status} error={error} txHash={txHash} />
            </>
          )}

          {isStatusView && (
            <TransactionStatusView
              kind={statusKind}
              title={
                status === 'success'
                  ? 'Success'
                  : status === 'paymentNotDone'
                    ? 'Payment Not Done'
                    : undefined
              }
              description={statusDescription}
              amountLabel={amountLabel}
              txHash={txHash ?? undefined}
              onClose={onClose}
              closeLabel={status === 'success' ? 'Done' : 'Close'}
              closeDisabled={closeDisabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}