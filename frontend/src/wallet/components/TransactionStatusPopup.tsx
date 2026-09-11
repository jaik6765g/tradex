// ============================================================
// TRANSACTION STATUS POPUP (DEPOSIT / WITHDRAWAL / ADMIN PAYOUT)
// ============================================================
//
// Professional centered status popup.
//
// Guarantees:
// - NEVER shows "Success/Completed" from local/transaction signals.
// - Only the caller decides the kind (processing / success / paymentNotDone / error,
//   which must be derived from BACKEND confirmation.
// ============================================================

import React from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

export type TransactionStatusKind =
  | 'processing'
  | 'success'
  | 'paymentNotDone'
  | 'error';

interface TransactionStatusViewProps {
  kind: TransactionStatusKind;

  title?: string;

  description?: string;

  /** e.g. "50 USDT (5,000 TDX)" */
  amountLabel?: string;

  /** e.g. "0xabc...123" */
  txHash?: string;

  onClose?: () => void;

  closeLabel?: string;

  closeDisabled?: boolean;
}

// ============================================================
// STATUS VIEW (card content, no overlay) — reused inside modals.
//
// ============================================================

export function TransactionStatusView({
  kind,
  title,
  description,
  amountLabel,
  txHash,
  onClose,
  closeLabel = 'Close',
  closeDisabled,
}: TransactionStatusViewProps) {
  const isProcessing = kind === 'processing';
  const isSuccess = kind === 'success';
  const isFailure = kind === 'paymentNotDone' || kind === 'error';

  const resolvedTitle = title ?? (isProcessing
    ? 'Processing'
    : isSuccess
      ? 'Success'
      : kind === 'paymentNotDone'
        ? 'Payment Not Done'
        : 'Error');

  const resolvedDescription = description ?? (isProcessing
    ? 'Please wait. This usually takes a few minutes.'
    : isSuccess
      ? 'Completed successfully.'
      : kind === 'paymentNotDone'
        ? 'The payment was not completed. No funds were credited.'
        : 'Something went wrong. Please try again.');

  const iconClass = isProcessing
    ? 'bg-amber-50 text-amber-500'
    : isSuccess
      ? 'bg-green-50 text-green-600'
      : 'bg-red-50 text-red-500';

  const icon = isProcessing ? (
    <Loader2 size={28} className="animate-spin" />
  ) : isSuccess ? (
    <Check size={28} />
  ) : (
    <AlertTriangle size={28} />
  );

  return (
    <div className="text-center">
      {/* Icon */}
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${iconClass}`}>
        {icon}
      </div>

      {/* Title */}
      <h3 className="mt-3 text-[15px] font-black text-[#111827]">
        {resolvedTitle}
      </h3>

      {/* Description */}
      <p className="mt-1 text-xs leading-5 text-[#475467]">
        {resolvedDescription}
      </p>

      {/* Amount / Token */}
      {amountLabel && (
        <p className="mt-3 text-lg font-black text-[#111827]">
          {amountLabel}
        </p>
      )}

      {/* Transaction status / hash */}
      {txHash && (
        <p className="mt-2 break-all rounded-lg bg-[#F8FAFC] px-2 py-1.5 font-mono text-[10px] text-[#667085]">
          Tx: {txHash}
        </p>
      )}

      {/* Close / Done */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[#E4E7EC] bg-white text-[11px] font-extrabold text-[#344054] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSuccess ? (closeLabel || 'Done') : (closeLabel || 'Close')}
        </button>
      )}
    </div>
  );
}

// ============================================================
// FULL-SCREEN CENTERED POPUP (fixed overlay + centered card)
// ============================================================

interface TransactionStatusPopupProps extends TransactionStatusViewProps {
  open: boolean;
}

export function TransactionStatusPopup({ open, ...viewProps }: TransactionStatusPopupProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[20px] border border-[#E5E7EB] bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.25)]">
        <TransactionStatusView {...viewProps} />
      </div>
    </div>
  );
}