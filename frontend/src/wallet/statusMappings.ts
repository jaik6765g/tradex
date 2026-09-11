// ============================================================
// CENTRALIZED STATUS MAPPING (DEPOSIT + WITHDRAWAL)
// ============================================================
//
// Source of truth: BACKEND statuses.
//
// Frontend NEVER shows "Completed/Success" from local/transaction
// signals. It only maps the backend-reported status to a UI label.
//
// This module is the single place that maps backend enums to UI
// labels, so the whole app speaks one consistent status language.
// ============================================================

export type UiTone = 'neutral' | 'info' | 'warning' | 'success' | 'error';

export interface StatusUi {
  label: string;
  tone: UiTone;
}

// ============================================================
// DEPOSIT STATUS → UI
// ============================================================
// PENDING            → Pending
// CONFIRMING         → Processing (verifying confirmations)
// VERIFIED           → Processing (ready / being credited)
// COMPLETED          → Completed (backend has credited TDX)
// FAILED             → Payment Not Done
// ============================================================

export function mapDepositStatusToUi(status: string | null | undefined): StatusUi {
  switch (status ?? '') {
    case 'PENDING':
      return { label: 'Pending', tone: 'warning' };
    case 'CONFIRMING':
      return { label: 'Processing', tone: 'warning' };
    case 'VERIFIED':
      return { label: 'Processing', tone: 'info' };
    case 'COMPLETED':
      return { label: 'Completed', tone: 'success' };
    case 'FAILED':
      return { label: 'Payment Not Done', tone: 'error' };
    default:
      const raw = String(status ?? '').trim();
      return raw
        ? { label: raw.charAt(0) + raw.slice(1).toLowerCase(), tone: 'neutral' }
        : { label: 'Unknown', tone: 'neutral' };
  }
}

export function isDepositTerminalSuccess(status: string | null | undefined): boolean {
  return status === 'COMPLETED';
}

export function isDepositTerminalFailure(status: string | null | undefined): boolean {
  return status === 'FAILED';
}

// ============================================================
// WITHDRAWAL STATUS → UI
// ============================================================
// REQUESTED / RISK_CHECKING / LIQUIDITY_CHECK /
// PENDING_ADMIN_APPROVAL                  → Pending
// APPROVED / QUEUED / PROCESSING / SENT   → Processing
// COMPLETED                               → Completed (backend verified on-chain payout)
// REJECTED / CANCELLED / FAILED          → Payment Not Done
// HOLD                                    → Hold
// ============================================================

const WITHDRAWAL_PENDING_STATUSES = new Set([
  'REQUESTED',
  'RISK_CHECKING',
  'LIQUIDITY_CHECK',
  'PENDING_ADMIN_APPROVAL',
]);

const WITHDRAWAL_PROCESSING_STATUSES = new Set([
  'APPROVED',
  'QUEUED',
  'PROCESSING',
  'SENT',
]);

const WITHDRAWAL_FAILURE_STATUSES = new Set([
  'REJECTED',
  'CANCELLED',
  'FAILED',
]);

export function mapWithdrawalStatusToUi(status: string | null | undefined): StatusUi {
  const normalized = String(status ?? '').trim();

  if (WITHDRAWAL_PENDING_STATUSES.has(normalized)) {

    return { label: 'Pending', tone: 'warning' };
  }

  if (WITHDRAWAL_PROCESSING_STATUSES.has(normalized)) {

    return { label: 'Processing', tone: 'info' };
  }

  if (normalized === 'COMPLETED') {



    return { label: 'Completed', tone: 'success' };
  }

  if (WITHDRAWAL_FAILURE_STATUSES.has(normalized)) {

    return { label: 'Payment Not Done', tone: 'error' };
  }

  if (normalized === 'HOLD') {

    return { label: 'Hold', tone: 'warning' };
  }

  return normalized
    ? { label: normalized.charAt(0) + normalized.slice(1).toLowerCase(), tone: 'neutral' }
    : { label: 'Unknown', tone: 'neutral' };
}

export function isWithdrawalTerminalSuccess(status: string | null | undefined): boolean {
  return status === 'COMPLETED';
}

export function isWithdrawalTerminalFailure(status: string | null | undefined): boolean {
  return WITHDRAWAL_FAILURE_STATUSES.has(String(status ?? '').trim());
}