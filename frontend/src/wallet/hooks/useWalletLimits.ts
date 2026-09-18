// frontend/src/wallet/hooks/useWalletLimits.ts
//
// Supplementary user-facing limits (backend remains the source of truth).
// Exposes the live limits plus exact Decimal-style numeric helpers for
// input validation.

import { useEffect, useState } from 'react';

import { WalletLimitsService, type WalletLimits } from '../services/limits.service';
import { MAX_USDT_DEPOSIT, MAX_USDT_WITHDRAWAL, MIN_USDT_DEPOSIT, MIN_USDT_WITHDRAWAL } from '../config/wallet';

export interface WalletLimitsState {
  limits: WalletLimits;
  /** Numeric convenience views derived from the string limits. */
  depositMin: number;
  depositMax: number;
  withdrawMin: number;
  withdrawMax: number;
  dailyWithdrawals: WalletLimits['dailyWithdrawals'];
}

const DEFAULT_STATE: WalletLimitsState = {
  limits: {
    deposit: { minUsdt: String(MIN_USDT_DEPOSIT), maxUsdt: String(MAX_USDT_DEPOSIT) },
    withdraw: { minUsdt: String(MIN_USDT_WITHDRAWAL), maxUsdt: String(MAX_USDT_WITHDRAWAL) },
    dailyWithdrawals: { mode: 'COUNT', value: 3, usedToday: null, resetsAt: null },
  },
  depositMin: MIN_USDT_DEPOSIT,
  depositMax: MAX_USDT_DEPOSIT,
  withdrawMin: MIN_USDT_WITHDRAWAL,
  withdrawMax: MAX_USDT_WITHDRAWAL,
  dailyWithdrawals: { mode: 'COUNT', value: 3, usedToday: null, resetsAt: null },
};

export function useWalletLimits(enabled: boolean = true): WalletLimitsState {
  const [state, setState] = useState<WalletLimitsState>(DEFAULT_STATE);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    WalletLimitsService.getLimits({ signal: controller.signal })
      .then((limits) => {
        setState({
          limits,
          depositMin: Number(limits.deposit.minUsdt),
          depositMax: Number(limits.deposit.maxUsdt),
          withdrawMin: Number(limits.withdraw.minUsdt),
          withdrawMax: Number(limits.withdraw.maxUsdt),
          dailyWithdrawals: limits.dailyWithdrawals,
        });
      })
      .catch(() => {
        /* fallbacks already in place */
      });

    return () => controller.abort();
  }, [enabled]);

  return state;
}
