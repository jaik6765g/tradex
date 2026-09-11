// frontend/src/admin/services/adminLotto.service.ts
// Admin Lotto Game Manager API service — all calls centralized here.
// Follows the existing AdminService static-method + apiClient convention.

import { apiClient } from '../../core/api/client';

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminLottoCategoryCard {
  category: string;
  round: {
    id: number;
    roundNumber: string;
    status: string;
    startAt: string | null;
    cutoffAt: string | null;
    drawAt: string | null;
    remainingSeconds: number;
    result: string | null;
    resultSource: string | null;
    resultGeneratedAt: string | null;
    settledAt: string | null;
  } | null;
  tickets: number;
  volume: number;
  reservedExposure: number;
}

export interface AdminLottoDashboard {
  controls: { paused: boolean; resultMode: string };
  categoryCards: AdminLottoCategoryCard[];
  game: { poolBalance: number; reservedLiquidity: number; availableLiquidity: number };
  totals: { totalTickets: number; totalVolume: number; currentOpenRounds: number };
  settlement: { pendingRounds: number; pendingTickets: number };
  recentResults: AdminLottoResultItem[];
  generatedAt: string;
}

export interface AdminLottoRound {
  id: number;
  roundNumber: string;
  category: string;
  status: string;
  startAt: string | null;
  cutoffAt: string | null;
  drawAt: string | null;
  result: string | null;
  resultSource: string | null;
  resultGeneratedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  totalTickets: number;
  totalAmount: number;
  reservedExposure: number;
  remainingSeconds: number;
}

export interface AdminLottoTicket {
  id: number;
  ticketNumber: string;
  userId: string;
  roundId: number;
  category: string;
  roundNumber: string;
  amount: number;
  selectedNumbers: string[];
  selectionCount: number;
  status: string;
  winAmount: number | null;
  createdAt: string | null;
  settledAt: string | null;
  settlement: {
    outcome: string;
    payoutAmount: number;
    status: string;
    settledAt: string | null;
  } | null;
}

export interface AdminLottoResultItem {
  id: number;
  roundId: number;
  roundNumber: string | null;
  category: string | null;
  result: string | null;
  resultSource: string | null;
  adminId: string | null;
  generatedAt: string | null;
  finalizedAt: string | null;
  drawAt: string | null;
  roundStatus: string | null;
  settlementStatus: string | null;
}

export interface AdminLottoSettings {
  game: { paused: boolean; resultMode: string };
  categories: { category: string; enabled: boolean; locked: boolean; durationSeconds: number }[];
  rules: { key: string; value: number; unit?: string; locked: boolean; breakdown?: Record<string, number> }[];
  resultModes: string[];
  liquidity: { poolBalance: number; reservedLiquidity: number; availableLiquidity: number };
  updatedAt: string;
}

const toFinite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export class AdminLottoService {
  static async getDashboard(): Promise<AdminLottoDashboard> {
    const response = await apiClient.get<AdminLottoDashboard>('/admin/lotto/dashboard');
    return response.data;
  }

  static async getRounds(params: {
    category?: string;
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminLottoRound>> {
    const response = await apiClient.get<PaginatedResponse<AdminLottoRound>>('/admin/lotto/rounds', {
      params: {
        ...(params.category ? { category: params.category } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.q ? { q: params.q } : {}),
        limit: params.limit ?? 25,
        offset: params.offset ?? 0,
      },
    });
    return response.data;
  }

  static async getRoundDetail(roundId: number): Promise<{ round: AdminLottoRound; tickets: AdminLottoTicket[] }> {
    const response = await apiClient.get<{ round: AdminLottoRound; tickets: AdminLottoTicket[] }>(
      `/admin/lotto/rounds/${roundId}`,
    );
    return response.data;
  }

  static async getTickets(params: {
    category?: string;
    roundId?: number;
    ticketId?: number;
    roundNumber?: string;
    status?: string;
    outcome?: string;
    userId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PaginatedResponse<AdminLottoTicket>> {
    const response = await apiClient.get<PaginatedResponse<AdminLottoTicket>>('/admin/lotto/tickets', {
      params: {
        ...(params.category ? { category: params.category } : {}),
        ...(params.roundId ? { roundId: params.roundId } : {}),
        ...(params.ticketId ? { ticketId: params.ticketId } : {}),
        ...(params.roundNumber ? { roundNumber: params.roundNumber } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.outcome ? { outcome: params.outcome } : {}),
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
    });
    return response.data;
  }

  static async getResults(params: { limit?: number; offset?: number } = {}): Promise<PaginatedResponse<AdminLottoResultItem>> {
    const response = await apiClient.get<PaginatedResponse<AdminLottoResultItem>>('/admin/lotto/results', {
      params: { limit: params.limit ?? 25, offset: params.offset ?? 0 },
    });
    return response.data;
  }

  static async getSettings(): Promise<AdminLottoSettings> {
    const response = await apiClient.get<AdminLottoSettings>('/admin/lotto/settings');
    return response.data;
  }

  static async pause(): Promise<{ paused: boolean }> {
    const response = await apiClient.post<{ paused: boolean }>('/admin/lotto/pause');
    return response.data;
  }

  static async resume(): Promise<{ paused: boolean }> {
    const response = await apiClient.post<{ paused: boolean }>('/admin/lotto/resume');
    return response.data;
  }

  static async setResultMode(resultMode: string): Promise<{ resultMode: string }> {
    const response = await apiClient.post<{ resultMode: string }>('/admin/lotto/settings/result-mode', {
      resultMode,
    });
    return response.data;
  }

  static async setManualResult(roundId: number, result: string, reason?: string): Promise<{ finalized: boolean; result: string | null }> {
    const response = await apiClient.post<{ finalized: boolean; result: string | null }>(
      `/admin/lotto/rounds/${roundId}/result`,
      { result, reason },
    );
    return response.data;
  }

  static async addLiquidity(amount: number, reason?: string): Promise<{ poolBalance: number; reservedLiquidity: number }> {
    const response = await apiClient.post<{ poolBalance: number; reservedLiquidity: number }>(
      '/admin/lotto/liquidity/add',
      { amount, reason },
    );
    return response.data;
  }

  static async removeLiquidity(amount: number, reason?: string): Promise<{ poolBalance: number; reservedLiquidity: number }> {
    const response = await apiClient.post<{ poolBalance: number; reservedLiquidity: number }>(
      '/admin/lotto/liquidity/remove',
      { amount, reason },
    );
    return response.data;
  }

  static readonly DURATION_LABELS: Record<string, string> = {
    THIRTY_SEC: '30 SEC',
    ONE_MIN: '1 MIN',
    THREE_MIN: '3 MIN',
    FIVE_MIN: '5 MIN',
  };

  static formatPercent(value: number, fractionDigits = 1): string {
    return `${toFinite(value).toFixed(fractionDigits)}%`;
  }
}