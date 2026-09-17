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
        // Authoritative server time (ISO) so the client can compute a clock
        // offset and stay correct even if the user's local clock is wrong.
        serverNow: response.data?.serverNow ?? null,
        // Authoritative WinGo 30-second period state (null until first sync).
        wingoPeriod: response.data?.wingoPeriod ?? null,
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

  /**
   * The result that is ALREADY PRE-COMPUTED for the round currently in its
   * cutoff window (betting closed, draw not yet reached), together with the
   * authoritative server instant it may be revealed at (`revealAt`).
   *
   * Lets the client cache the value a few seconds early so the 00:00 reveal is
   * instant and requires no API call at exactly 0. Returns
   * `{ pendingResult: null }` outside that window.
   */
  async getPendingResult({ category } = {}) {
    try {
      const response = await apiClient.get('/lotto/results/pending', {
        params: category ? { category } : undefined,
      });

      return {
        serverNow: response.data?.serverNow ?? null,
        pendingResult: normalizeResultItem(response.data?.pendingResult),
      };
    } catch (error) {
      rethrowApiError(error, 'Failed to fetch pending result');
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
