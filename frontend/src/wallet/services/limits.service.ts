// ============================================================
// TRADEX LIMITS SERVICE (supplementary frontend validation only)
// ============================================================
//
// Reads the backend-authoritative deposit/withdrawal limits from
// GET /withdrawals/limits. The backend enforces every limit inside its own
// transaction; this service exists purely to guide user input BEFORE
// submission (UX). Falls back to the build-time constants when the endpoint
// is unavailable so the wallet UI stays usable offline.

import { apiClient } from '../../core/api/client';

import {
  MAX_USDT_DEPOSIT,
  MAX_USDT_WITHDRAWAL,
  MIN_USDT_DEPOSIT,
  MIN_USDT_WITHDRAWAL,
} from '../config/wallet';

export interface DailyWithdrawalsLimit {
  mode: 'COUNT' | 'UNLIMITED';
  value: number | null;
  usedToday: number | null;
  /** Next Asia/Kolkata midnight in UTC ISO form (null when unlimited). */
  resetsAt: string | null;
}

export interface WalletLimits {
  deposit: { minUsdt: string; maxUsdt: string };
  withdraw: { minUsdt: string; maxUsdt: string };
  dailyWithdrawals: DailyWithdrawalsLimit;
}

const FALLBACK_LIMITS: WalletLimits = {
  deposit: {
    minUsdt: String(MIN_USDT_DEPOSIT),
    maxUsdt: String(MAX_USDT_DEPOSIT),
  },
  withdraw: {
    minUsdt: String(MIN_USDT_WITHDRAWAL),
    maxUsdt: String(MAX_USDT_WITHDRAWAL),
  },
  dailyWithdrawals: { mode: 'COUNT', value: 3, usedToday: null, resetsAt: null },
};

interface LimitsEnvelope {
  success?: boolean;
  data?: WalletLimits;
}

export class WalletLimitsService {
  static async getLimits(options?: {
    signal?: AbortSignal;
  }): Promise<WalletLimits> {
    try {
      const res = await apiClient.get<LimitsEnvelope>('/withdrawals/limits', {
        signal: options?.signal,
      });
      const data = res.data?.data;
      if (data?.deposit && data?.withdraw && data?.dailyWithdrawals) {
        return data;
      }
      return FALLBACK_LIMITS;
    } catch {
      // Supplementary-only data: degrade to fallbacks, never block the UI.
      return FALLBACK_LIMITS;
    }
  }
}
