import { useEffect, useRef, useState, useCallback } from 'react';
import { AdminLottoService, type AdminLottoExposure } from '../services/adminLotto.service';

const POLL_INTERVAL_MS = 3000;

export function useLottoExposure(category = 'THIRTY_SEC') {
  const [exposure, setExposure] = useState<AdminLottoExposure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await AdminLottoService.getCurrentExposure(category);
      setExposure(data);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load exposure';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
    intervalRef.current = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [load]);

  return { exposure, loading, error, updatedAt, refresh: load };
}
