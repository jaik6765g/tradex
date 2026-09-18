// frontend/src/wallet/withdrawal/hooks/useWithdrawalWagering.ts
//
// Withdrawal-screen wagering eligibility (display guidance only — the
// backend remains the final authority inside its locked transaction).
//
// Reuses the existing GET /wagering/me endpoint (wageringService) so no
// second eligibility system is introduced. A module-level in-flight cache
// with a short TTL avoids duplicate requests when both this hook and
// WageringSummaryCard mount on the WithdrawalScreen. All money stays as
// exact decimal strings; no floating-point arithmetic is used here.

import { useCallback, useEffect, useState } from 'react';

import {
  wageringService,
  type WageringSummary,
} from '../../services/wagering.service';

export interface WithdrawalWageringState {
  summary: WageringSummary | null;
  loading: boolean;
  error: string | null;
  /** Backend-authoritative withdrawal eligibility flag (may be null when unknown). */
  withdrawalEligible: boolean | null;
  /** Exact remaining-wagering decimal string from the backend (TDX). */
  remainingTdx: string | null;
  refresh: () => void;
}

interface CachedEntry {
  summary: WageringSummary;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;

let cached: CachedEntry | null = null;
let inFlight: Promise<WageringSummary> | null = null;

async function loadSummary(signal?: AbortSignal): Promise<WageringSummary> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.summary;
  }
  if (!inFlight) {
    inFlight = wageringService
      .getMySummary()
      .then((summary) => {
        cached = { summary, fetchedAt: Date.now() };
        return summary;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  const result = await inFlight;
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return result;
}

export function clearWithdrawalWageringCache(): void {
  cached = null;
  inFlight = null;
}

export function useWithdrawalWagering(
  enabled: boolean = true,
): WithdrawalWageringState {
  const [summary, setSummary] = useState<WageringSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    loadSummary(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Guidance only: a failed fetch must never block the screen.
        setSummary(null);
        setError('Wagering status is temporarily unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, nonce]);

  const refresh = useCallback(() => {
    clearWithdrawalWageringCache();
    setNonce((value) => value + 1);
  }, []);

  return {
    summary,
    loading,
    error,
    withdrawalEligible:
      summary === null ? null : Boolean(summary.withdrawalEligible),
    remainingTdx: summary?.totalRemaining ?? null,
    refresh,
  };
}
