// ============================================================
// DEPOSIT SERVICE - Backend API Calls
// ============================================================

import { apiClient } from '../../../core/api/client';

// ============================================================
// DEPOSIT STATUS
// ============================================================

export type DepositHistoryStatus =
  | 'PENDING'
  | 'CONFIRMING'
  | 'VERIFIED'
  | 'COMPLETED'
  | 'FAILED';

// ============================================================
// DEPOSIT RESPONSE
// ============================================================

export interface DepositResponse {
  id: string;

  userId: string;

  chainId: number;

  transactionHash: string;

  usdtAmount: number;

  tdxAmount: number;

  status: DepositHistoryStatus;

  confirmations: number;

  requiredConfirmations: number;

  createdAt: string;

  confirmedAt?: string;

  creditedAt?: string;
}

// ============================================================
// DEPOSIT STATUS POLL RESPONSE (from /deposits/tx/:hash/status)
// ============================================================

export interface DepositStatusPollResponse {
  /** false = backend watcher has not detected/created the deposit yet. */
  found: boolean;

  /** Authoritative backend deposit status. */
  status: DepositHistoryStatus;

  /** true only after backend creditDeposit() succeeded. */
  credited: boolean;
}

// ============================================================
// DEPOSIT SERVICE
// ============================================================

export class DepositService {
  // ==========================================================
  // GET MY DEPOSIT HISTORY
  // ==========================================================

  static async getMyDeposits(
    limit: number = 20,
    offset: number = 0,
  ): Promise<DepositResponse[]> {
    const response =
      await apiClient.get<
        DepositResponse[] | { data?: DepositResponse[]; total?: unknown }
      >(
        '/deposits/me',
        {
          params: {
            limit,
            offset,
          },
        },
      );

    // GET /deposits/me returns a paginated envelope:
    //   { data: [...], total, limit, offset }
    // Normalize here so screens/hooks always receive a plain array.
    const raw = response.data;
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.data)) {
      return raw.data;
    }
    return [];
  }

  // ==========================================================
  // GET DEPOSIT BY ID
  // ==========================================================

  static async getDepositById(
    depositId: string,
  ): Promise<DepositResponse> {
    const response =
      await apiClient.get<DepositResponse>(
        `/deposits/${depositId}`,
      );

    return response.data;
  }

  // ==========================================================
  // GET DEPOSIT BY TRANSACTION HASH
  // ==========================================================

  static async getDepositByTxHash(
    txHash: string,
  ): Promise<DepositResponse> {
    const response =
      await apiClient.get<DepositResponse>(
        `/deposits/tx/${txHash}`,
      );

    return response.data;
  }

  // ==========================================================
  // POLL DEPOSIT STATUS BY TRANSACTION HASH
  // ==========================================================
  //
  // Poll-friendly endpoint: ALWAYS returns 200.
  //
  // - found: false  → backend watcher has not detected/created the
  //                   deposit record yet → keep showing PROCESSING.
  // - found: true   → authoritative backend status. COMPLETED is only
  //                   ever returned after TDX credit succeeded.
  // ==========================================================

  static async getDepositStatusByTxHash(
    txHash: string,
  ): Promise<DepositStatusPollResponse> {
    const response =
      await apiClient.get<DepositStatusPollResponse>(
        `/deposits/tx/${encodeURIComponent(txHash)}/status`,
      );

    return response.data;
  }
}