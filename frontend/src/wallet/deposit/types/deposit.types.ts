// ============================================================
// DEPOSIT TYPES
// ============================================================

export interface DepositParams {
  amount: string;
}

export interface DepositResult {
  success: boolean;
  txHash?: string;
  usdtAmount?: number;
  tdxAmount?: number;
  error?: string;
}

export type DepositStatus =
  | 'idle'
  | 'approving'
  | 'depositing'
  | 'processing'
  | 'success'
  | 'paymentNotDone'
  | 'error';

export interface DepositState {
  amount: string;
  status: DepositStatus;
  error: string | null;
  txHash: string | null;
}