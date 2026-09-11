// ============================================================
// USE TRANSACTION HISTORY HOOK
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { TransactionService } from '../services/transaction.service';
import { Transaction, TransactionFilter, TransactionHistoryState } from '../types/transaction.types';

const initialState: TransactionHistoryState = {
  transactions: [],
  isLoading: false,
  error: null,
  total: 0,
  hasMore: true,
};

export function useTransactionHistory(userId: string) {
  const [state, setState] = useState<TransactionHistoryState>(initialState);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<TransactionFilter>({});
  const limit = 20;

  // ============================================================
  // FETCH TRANSACTIONS
  // ============================================================

  const fetchTransactions = useCallback(
    async ({
      reset = true,
      nextFilter,
      nextOffset,
    }: {
      reset?: boolean;
      nextFilter?: TransactionFilter;
      nextOffset?: number;
    } = {}) => {
      if (!userId) return;

      const activeFilter = nextFilter ?? filter;
      const currentOffset =
        nextOffset ?? (reset ? 0 : offset);

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const data = await TransactionService.getTransactions(
          userId,
          limit,
          currentOffset,
          activeFilter,
        );

        setState((prev) => ({
          transactions: reset ? data.items : [...prev.transactions, ...data.items],
          isLoading: false,
          error: null,
          total: data.total,
          hasMore: data.hasMore ?? (currentOffset + data.items.length < data.total),
        }));

        setOffset(currentOffset + data.items.length);
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch transactions',
        }));
      }
    },
    [userId, offset, filter, limit]
  );

  // ============================================================
  // LOAD MORE
  // ============================================================

  const loadMore = useCallback(() => {
    if (state.hasMore && !state.isLoading) {
      fetchTransactions({
        reset: false,
        nextOffset: offset,
      });
    }
  }, [state.hasMore, state.isLoading, fetchTransactions, offset]);

  // ============================================================
  // REFRESH
  // ============================================================

  const refresh = useCallback(() => {
    setOffset(0);
    fetchTransactions({
      reset: true,
      nextOffset: 0,
    });
  }, [fetchTransactions]);

  // ============================================================
  // APPLY FILTER
  // ============================================================

  const applyFilter = useCallback(
    (newFilter: TransactionFilter) => {
      setFilter(newFilter);
      setOffset(0);
      fetchTransactions({
        reset: true,
        nextFilter: newFilter,
        nextOffset: 0,
      });
    },
    [fetchTransactions]
  );

  // ============================================================
  // EFFECTS
  // ============================================================

  useEffect(() => {
    if (userId) {
      fetchTransactions({
        reset: true,
        nextOffset: 0,
      });
      return;
    }
    setState(initialState);
    setFilter({});
    setOffset(0);
  }, [userId]);

  return {
    ...state,
    loadMore,
    refresh,
    applyFilter,
  };
}