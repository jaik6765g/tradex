// ============================================================
// TRANSACTION TYPES
// ============================================================

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw' | 'trade' | 'game' | 'bonus' | 'other';
  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'rejected'
    | 'approved'
    | 'cancelled'
    | 'verifying'
    | 'confirmed';
  amount: string;
  currency: string;
  tdxAmount: string;
  usdtAmount?: string;  // ✅ Add this for deposits
  txHash: string;
  timestamp: string;
  description?: string;
  /** Raw ledger metadata (bonus reason lives in metadata.description). */
  metadata?: Record<string, unknown>;
  /**
   * Presentation direction derived from the ledger type/metadata.
   * Unknown types leave this undefined so consuming UIs can fall
   * back to their generic transaction presentation.
   */
  direction?: 'credit' | 'debit';
}

export interface TransactionFilter {
  type?: Transaction['type'];
  status?: Transaction['status'];
  startDate?: string;
  endDate?: string;
}

export interface TransactionHistoryState {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
}