// src/marketplace/games/lotto/services/lottoApi.js
import { apiClient } from '../../../../core/api/client';
import { withOptionalIdempotencyKey } from './lottoApi.idempotency';
import {
  mapKnownLottoError,
  normalizeErrorCode,
  normalizePagination,
  normalizeResultItem,
  normalizeRound,
  normalizeRoundQueryId,
  normalizeSelectedNumbers,
  normalizeTicket,
  toApiErrorMessage,
  toFiniteNumber,
} from './lottoApi.normalizers';

const rethrowApiError = (error, fallback) => {
  throw new Error(toApiErrorMessage(error, fallback));
};

export const __lottoApiTestables = {
  normalizeSelectedNumbers,
  normalizeErrorCode,
  mapKnownLottoError,
  toApiErrorMessage,
};

export const lottoApi = {
  async getActiveRound({ category } = {}) {
    try {
      const response = await apiClient.get('/lotto/rounds/active', {
        params: category ? { category } : undefined,
      });

      const controls = response.data?.controls ?? {};

      return {
        controls: {
          paused: Boolean(controls.paused),
          resultMode: String(controls.resultMode ?? 'SERVER_RANDOM'),
        },
        round: normalizeRound(response.data?.round),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch active round');
    }
  },

  async getRoundById(roundId) {
    try {
      const response = await apiClient.get(`/lotto/rounds/${roundId}`);
      return {
        round: normalizeRound(response.data?.round),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch round details');
    }
  },

  async placeTicket({ roundId, amount, selectedNumbers, idempotencyKey }) {
    try {
      const response = await apiClient.post(
        '/lotto/tickets',
        withOptionalIdempotencyKey(
          {
            roundId: normalizeRoundQueryId(roundId),
            amount: toFiniteNumber(amount),
            selectedNumbers: normalizeSelectedNumbers(selectedNumbers),
          },
          idempotencyKey,
        ),
      );

      return {
        ticket: normalizeTicket(response.data?.ticket),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to place ticket');
    }
  },

  async getMyTickets({ limit = 20, offset = 0, roundId, status, category } = {}) {
    try {
      const normalizedRoundId = normalizeRoundQueryId(roundId);

      const response = await apiClient.get('/lotto/tickets/me', {
        params: {
          limit,
          offset,
          ...(normalizedRoundId ? { roundId: normalizedRoundId } : {}),
          ...(status ? { status } : {}),
          ...(category ? { category } : {}),
        },
      });

      const pagination = normalizePagination(response.data ?? {}, { limit, offset });

      return {
        ...pagination,
        items: Array.isArray(response.data?.items)
          ? response.data.items.map(normalizeTicket).filter(Boolean)
          : [],
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch your tickets');
    }
  },

  async getTicketById(ticketId) {
    try {
      const response = await apiClient.get(`/lotto/tickets/${ticketId}`);
      return {
        ticket: normalizeTicket(response.data?.ticket),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch ticket details');
    }
  },

  async getRecentResults({ limit = 20, offset = 0, category } = {}) {
    try {
      const response = await apiClient.get('/lotto/results/recent', {
        params: {
          limit,
          offset,
          ...(category ? { category } : {}),
        },
      });

      const pagination = normalizePagination(response.data ?? {}, { limit, offset });

      return {
        ...pagination,
        items: Array.isArray(response.data?.items)
          ? response.data.items.map(normalizeResultItem).filter(Boolean)
          : [],
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch recent results');
    }
  },

  async getResultByRoundId(roundId) {
    try {
      const response = await apiClient.get(`/lotto/results/${roundId}`);
      return {
        result: normalizeResultItem(response.data?.result),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch round result');
    }
  },

  // Backward-compatible aliases
  async placeBet(roundId, numbers, amount, idempotencyKey) {
    return this.placeTicket({
      roundId,
      amount,
      selectedNumbers: numbers,
      idempotencyKey,
    });
  },

  async getUserHistory(limit = 20, offset = 0) {
    return this.getMyTickets({ limit, offset });
  },

  async getUserBets(roundId) {
    return this.getMyTickets({ roundId, limit: 100, offset: 0 });
  },

  getErrorMessage(error, fallback) {
    return toApiErrorMessage(error, fallback);
  },
};
