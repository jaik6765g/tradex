// frontend/src/wallet/services/wagering.service.ts
//
// User-facing wagering API client (backend/src/wagering/wagering.controller.ts).
// All money values are exact 18dp decimal strings — never parsed into floats.

import { apiClient } from '../../core/api/client';

export type WageringMultiplierSource = 'USER_OVERRIDE' | 'GLOBAL_DEFAULT';

export type WageringObligationStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export type WageringObligation = {
  id: string;
  userId: string;
  depositId: string;
  ledgerEntryId: string;
  sourceUsdtAmount: string;
  sourceTdxAmount: string;
  conversionRate: string;
  depositAmountTdx: string;
  multiplier: number;
  requiredAmount: string;
  completedAmount: string;
  remainingAmount: string;
  status: WageringObligationStatus;
  policyVersion: number;
  eligibleActivity: 'LOTTO' | 'TRADE' | 'BOTH';
  expiresAt?: string | null;
  cancelledReason?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type WageringSummary = {
  wageringEnabled: boolean;
  withdrawalEligible: boolean;
  applicableMultiplier: number;
  multiplierSource: WageringMultiplierSource;
  totalRequired: string;
  totalCompleted: string;
  totalRemaining: string;
  ruleExplanation: string;
  obligations: WageringObligation[];
};

export type WageringNotification = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
};

/** Formats an exact 18dp string for display; trims insignificant zeros only. */
export function formatWageringAmount(
  value?: string | null,
  maxDecimals = 6,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  const rendered = trimmed ? `${whole}.${trimmed}` : whole;
  return negative ? `-${rendered}` : rendered;
}

export const wageringService = {
  getMySummary: async (): Promise<WageringSummary> => {
    const response = await apiClient.get<WageringSummary>('/wagering/me');
    return response.data;
  },

  getNotifications: async (): Promise<WageringNotification[]> => {
    const response = await apiClient.get<WageringNotification[]>(
      '/wagering/me/notifications',
    );
    return Array.isArray(response.data) ? response.data : [];
  },

  markNotificationsRead: async (): Promise<void> => {
    await apiClient.post('/wagering/me/notifications/read', {});
  },
};
