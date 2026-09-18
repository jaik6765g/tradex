// frontend/src/admin/services/wagering.service.ts
//
// Thin API client for the admin wagering endpoints
// (backend/src/wagering/wagering-admin.controller.ts).
//
// Every mutating call carries a mandatory non-empty `reason`; the backend
// enforces this (class-validator + DB CHECK) and writes an immutable audit row.

import { apiClient } from '../../core/api/client';
import type {
  UpdateWageringSettingsPayload,
  WageringAuditQueryParams,
  WageringAuditResponse,
  WageringObligation,
  WageringObligationListResponse,
  WageringObligationQueryParams,
  WageringOverride,
  WageringSettings,
  WageringUserSummary,
} from '../types/wagering.types';

type UpdateSettingsResponse = {
  settings: WageringSettings;
  policyVersion: number;
};

type ReconcileResponse = {
  scanned: number;
  created: number;
  skipped: number;
};

function encodeUserId(userId: string): string {
  return encodeURIComponent(userId);
}

export const adminWageringService = {
  getSettings: async (): Promise<WageringSettings> => {
    const response = await apiClient.get<WageringSettings>(
      '/admin/wagering/settings',
    );
    return response.data;
  },

  updateSettings: async (
    payload: UpdateWageringSettingsPayload,
  ): Promise<UpdateSettingsResponse> => {
    const response = await apiClient.patch<UpdateSettingsResponse>(
      '/admin/wagering/settings',
      payload,
    );
    return response.data;
  },

  getOverride: async (userId: string): Promise<WageringOverride | null> => {
    const response = await apiClient.get<WageringOverride | null>(
      `/admin/wagering/overrides/${encodeUserId(userId)}`,
    );
    return response.data ?? null;
  },

  setOverride: async (
    userId: string,
    multiplier: number,
    reason: string,
  ): Promise<WageringOverride> => {
    const response = await apiClient.put<WageringOverride>(
      `/admin/wagering/overrides/${encodeUserId(userId)}`,
      { userId, multiplier, reason },
    );
    return response.data;
  },

  removeOverride: async (userId: string, reason: string): Promise<void> => {
    await apiClient.delete(`/admin/wagering/overrides/${encodeUserId(userId)}`, {
      data: { reason },
    });
  },

  getUserSummary: async (userId: string): Promise<WageringUserSummary> => {
    const response = await apiClient.get<WageringUserSummary>(
      `/admin/wagering/users/${encodeUserId(userId)}/summary`,
    );
    return response.data;
  },

  listObligations: async (
    query: WageringObligationQueryParams = {},
  ): Promise<WageringObligationListResponse> => {
    const response = await apiClient.get<WageringObligationListResponse>(
      '/admin/wagering/obligations',
      { params: query },
    );
    return response.data;
  },

  cancelObligation: async (
    obligationId: string,
    reason: string,
  ): Promise<WageringObligation> => {
    const response = await apiClient.post<WageringObligation>(
      `/admin/wagering/obligations/${encodeURIComponent(obligationId)}/cancel`,
      { reason },
    );
    return response.data;
  },

  getAudit: async (
    query: WageringAuditQueryParams = {},
  ): Promise<WageringAuditResponse> => {
    const response = await apiClient.get<WageringAuditResponse>(
      '/admin/wagering/audit',
      { params: query },
    );
    return response.data;
  },

  reconcile: async (): Promise<ReconcileResponse> => {
    const response = await apiClient.post<ReconcileResponse>(
      '/admin/wagering/reconcile',
      {},
    );
    return response.data;
  },
};

export const AdminWageringService = adminWageringService;

export function extractWageringErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      response?: { data?: { message?: string | string[] } };
      message?: string;
    };
    const backendMessage = candidate.response?.data?.message;
    if (Array.isArray(backendMessage) && backendMessage.length > 0) {
      return backendMessage.join(' ');
    }
    if (typeof backendMessage === 'string' && backendMessage.trim()) {
      return backendMessage;
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
  }
  return 'Wagering request failed';
}