import type { WithdrawalStatus } from '../services/withdrawal.service';

// ============================================================
// WITHDRAWAL TYPES
// ============================================================

export interface WithdrawParams {
  amount: string;
  walletAddress: string;
}

export interface WithdrawResult {
  success: boolean;
  withdrawalId?: string;
  txHash?: string;
  usdtAmount?: number;
  tdxAmount?: number;
  error?: string;
  status?: WithdrawalStatus;
}

export interface WithdrawState {
  amount: string;
  address: string;
  status: 'idle' | 'requesting' | 'processing' | 'success' | 'error';
  error: string | null;
  withdrawalId: string | null;
}

export type WithdrawStatus = 'idle' | 'requesting' | 'processing' | 'success' | 'paymentNotDone' | 'error';