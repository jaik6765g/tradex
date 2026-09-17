// ============================================================
// WITHDRAW MODAL - Centered Status Popup
// ============================================================
//
// Success is ONLY shown after the BACKEND reports the withdrawal as
// COMPLETED (on-chain payout verified by the backend). Requesting/
// processing views are shown while the withdrawal is being processed.
// ============================================================

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useWithdraw } from '../hooks/useWithdraw';
import { WithdrawForm } from './WithdrawForm';
import { WithdrawalStatus } from './WithdrawalStatus';
import {
  TransactionStatusView,
  type TransactionStatusKind,
} from '../../components/TransactionStatusPopup';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  maxTdxBalance: string;
  onSuccess?: (result: { usdtAmount: number; tdxAmount: number }) => void;
}

export function WithdrawModal({
  isOpen,
  onClose,
  userId,
  maxTdxBalance,
  onSuccess,
}: WithdrawModalProps) {
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const { withdraw, status, error, withdrawalId, isLoading, isSuccess, usdtAmount, tdxAmount, reset } = useWithdraw(
    userId,
    (result) => {
      onSuccess?.({ usdtAmount: result.usdtAmount!, tdxAmount: result.tdxAmount! });
    }
  );

  if (!isOpen) return null;

  const handleWithdraw = async () => {
    await withdraw(amount, address);
  };

  const isFormView =
    status === 'idle' ||
    status === 'requesting';

  const isStatusView =
    status === 'processing' ||
    status === 'success' ||
    status === 'paymentNotDone' ||
    status === 'error';

  const closeDisabled = status === 'requesting';

  const amountLabel =
    tdxAmount > 0
      ? `${tdxAmount} TDX${usdtAmount > 0 ? ` (${usdtAmount} USDT)` : ''}`
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
      ? 'Your withdrawal is being processed.'
      : status === 'success'
        ? 'Withdrawal completed successfully.'
        : status === 'paymentNotDone'
          ? 'The withdrawal payment was not completed.'
          : error ?? 'Withdrawal failed. Please try again.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[20px] border border-[#292B33] bg-[#15161C] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.25)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black text-[#F5F5F7]">📤 Withdraw</h2>
            <p className="text-xs text-[#A1A4AE]">100 TDX = 1 USDT</p>
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
              <WithdrawForm
                amount={amount}
                setAmount={setAmount}
                address={address}
                setAddress={setAddress}
                onSubmit={handleWithdraw}
                isLoading={isLoading}
                isSuccess={isSuccess}
                maxBalance={maxTdxBalance}
                usdtAmount={usdtAmount}
              />
              <WithdrawalStatus status={status} error={error} withdrawalId={withdrawalId} />
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
              txHash={withdrawalId ?? undefined}
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