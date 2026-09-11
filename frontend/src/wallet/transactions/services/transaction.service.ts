// ============================================================
// TRANSACTION SERVICE
// ============================================================

import { Transaction, TransactionFilter } from '../types/transaction.types';
import { WalletService } from '../../services/wallet.service';
import type { TransactionListResponse } from '../../services/wallet.service';

export class TransactionService {
  // ============================================================
  // GET TRANSACTIONS
  // ============================================================

  static async getTransactions(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    filter?: TransactionFilter
  ): Promise<TransactionListResponse> {
    return WalletService.getTransactions(userId, limit, offset, filter);
  }

  // ============================================================
  // GET TRANSACTION BY ID
  // ============================================================

  static async getTransaction(txId: string): Promise<Transaction> {
    return WalletService.getTransaction(txId);
  }

  // ============================================================
  // GET TRANSACTION SUMMARY
  // ============================================================

  static async getTransactionSummary(userId: string): Promise<{
    totalDeposits: string;
    totalWithdrawals: string;
    totalTrades: string;
    totalGames: string;
  }> {
    return WalletService.getTransactionSummary(userId);
  }
}