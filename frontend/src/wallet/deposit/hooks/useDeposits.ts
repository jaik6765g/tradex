import { useState, useEffect, useCallback } from 'react';
import { DepositService, DepositResponse } from '../services/deposit.service';

interface UseDepositsReturn {
  deposits: DepositResponse[];
  loading: boolean;
  error: string | null;
  isUnauthenticated: boolean;
  refresh: () => Promise<void>;
}

export function useDeposits(userId?: string): UseDepositsReturn {
  const [deposits, setDeposits] = useState<DepositResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthenticated, setIsUnauthenticated] = useState(false);

  const fetchDeposits = useCallback(async () => {
    if (!userId) {
      setDeposits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setIsUnauthenticated(false);

    try {
      const data = await DepositService.getMyDeposits();
      setDeposits(data);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        setIsUnauthenticated(true);
        setError('Authentication required. Please login again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch deposit history');
      }
      setDeposits([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchDeposits();
  }, [fetchDeposits]);

  return {
    deposits,
    loading,
    error,
    isUnauthenticated,
    refresh: fetchDeposits,
  };
}
