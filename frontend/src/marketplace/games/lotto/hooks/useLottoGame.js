import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useWalletContext } from '../../../../wallet/context/WalletContext';
import { lottoApi } from '../services/lottoApi';
import {
  TERMINAL_TICKET_STATUSES,
  TICKET_STATUS,
  deriveTicketOutcomeStatus,
  normalizeRoundStatus,
  normalizeTicketStatus,
} from '../utils/lottoState';
import {
  toCanonicalResultView,
  toCanonicalTicketHistoryRow,
} from '../utils/lottoPresentation.js';
import { LOTTO_CONSTANTS } from '../utils/constants';

const POLL_INTERVAL_MS = 10_000;
const IDEMPOTENCY_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_CONTROLS = {
  paused: false,
  resultMode: 'SERVER_RANDOM',
};

// Backend Category enum: THIRTY_SEC | ONE_MIN | THREE_MIN | FIVE_MIN (no 10-min)
const VALID_CATEGORIES = new Set([
  'THIRTY_SEC',
  'ONE_MIN',
  'THREE_MIN',
  'FIVE_MIN',
]);
const DEFAULT_CATEGORY = LOTTO_CONSTANTS.CATEGORY || 'THIRTY_SEC';

let idempotencyFallbackCounter = 0;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toTimerSeconds = (round) => {
  if (!round?.cutoffAt) {
    return 0;
  }

  const cutoffAtMs = new Date(round.cutoffAt).getTime();
  if (!Number.isFinite(cutoffAtMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((cutoffAtMs - Date.now()) / 1000));
};

const normalizeRoundForUi = (round) => {
  if (!round) return null;

  return {
    ...round,
    remainingTime: toTimerSeconds(round),
    status: normalizeRoundStatus(round.status),
  };
};

const normalizeTicketForUi = (ticket) => {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }

  const normalizedStatus = normalizeTicketStatus(ticket.status);
  const winAmount = Number(ticket.winAmount ?? 0);
  const hasKnownWinAmount = Number.isFinite(winAmount);
  const effectiveWinAmount = hasKnownWinAmount ? winAmount : 0;
  const isPending =
    normalizedStatus === TICKET_STATUS.ACTIVE ||
    normalizedStatus === TICKET_STATUS.CUTOFF;
  const isTerminal = TERMINAL_TICKET_STATUSES.has(normalizedStatus);
  const outcomeStatus = deriveTicketOutcomeStatus(normalizedStatus, effectiveWinAmount);

  return {
    ...ticket,
    status: normalizedStatus,
    winAmount: hasKnownWinAmount ? effectiveWinAmount : null,
    isPending,
    isSettled: isTerminal,
    isWin:
      outcomeStatus === TICKET_STATUS.WIN ||
      (outcomeStatus === TICKET_STATUS.REFUNDED && effectiveWinAmount > 0),
    outcomeStatus,
  };
};

const normalizeHistoryTicketForUi = (ticket) => {
  const canonical = toCanonicalTicketHistoryRow(ticket);
  if (!canonical) {
    return null;
  }

  return normalizeTicketForUi({
    ...ticket,
    ...canonical,
  });
};

const normalizeResultForUi = (result) => {
  const canonical = toCanonicalResultView(result);
  if (!canonical) {
    return null;
  }

  return {
    ...result,
    ...canonical,
  };
};

const buildIdempotencyKey = (roundId, selectedNumbers, amount) => {
  let seed;

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    seed = crypto.randomUUID();
  } else if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    seed = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } else {
    idempotencyFallbackCounter += 1;
    seed = `${Date.now()}-${idempotencyFallbackCounter}`;
  }

  return `lotto-${roundId}-${amount}-${selectedNumbers.join('')}-${seed}`;
};

const toPurchaseSignature = (roundId, selectedNumbers, amount) => {
  const normalizedNumbers = [...selectedNumbers].sort().join('');
  return `${roundId}|${amount}|${normalizedNumbers}`;
};

const pruneExpiredIdempotencyCache = (cache, nowMs) => {
  cache.forEach((entry, key) => {
    if (!entry || nowMs - entry.createdAtMs > IDEMPOTENCY_CACHE_TTL_MS) {
      cache.delete(key);
    }
  });
};

const normalizeSelection = (numbers) => {
  if (!Array.isArray(numbers)) return [];

  const deduped = Array.from(
    new Set(numbers.map((value) => String(value ?? '').trim().toUpperCase())),
  );

  return deduped.filter((value) => /^[0-9A-F]$/.test(value));
};

export const useLottoGame = () => {
  const {
    isAuthenticated,
    userId,
    balance: walletBalance,
    refresh: refreshWallet,
  } = useWalletContext();

  const [loading, setLoading] = useState(false);
  const [placingBet, setPlacingBet] = useState(false);
  const [activeRound, setActiveRound] = useState(null);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [history, setHistory] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [error, setError] = useState(null);

  const [historyMeta, setHistoryMeta] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const [resultsMeta, setResultsMeta] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(null);

  const [ticketDetail, setTicketDetail] = useState(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);
  const [ticketDetailError, setTicketDetailError] = useState(null);

  const [latestTicket, setLatestTicket] = useState(null);

  const isMountedRef = useRef(false);
  const pollRef = useRef(null);
  const activeRoundRef = useRef(null);
  const categoryRef = useRef(DEFAULT_CATEGORY);
  const historyCategoryRef = useRef(DEFAULT_CATEGORY);
  const idempotencyCacheRef = useRef(new Map());
  const pendingPurchaseRef = useRef(null);

  const balance = useMemo(() => {
    const rawValue = walletBalance?.tdxAvailable || walletBalance?.tdx || '0';
    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : 0;
  }, [walletBalance?.tdxAvailable, walletBalance?.tdx]);

  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated || !userId) {
      return;
    }

    try {
      await refreshWallet();
    } catch (apiError) {
      if (!isMountedRef.current) return;
      setError(lottoApi.getErrorMessage(apiError, 'Failed to fetch wallet balance'));
    }
  }, [isAuthenticated, refreshWallet, userId]);

  const getActiveRound = useCallback(async (categoryOverride) => {
    const targetCategory = categoryOverride ?? categoryRef.current;
    try {
      const response = await lottoApi.getActiveRound(
        targetCategory ? { category: targetCategory } : undefined,
      );
      if (!isMountedRef.current) return null;

      const normalizedRound = normalizeRoundForUi(response.round);
      setControls(response.controls ?? DEFAULT_CONTROLS);
      setActiveRound(normalizedRound);
      activeRoundRef.current = normalizedRound;
      return normalizedRound;
    } catch (apiError) {
      if (!isMountedRef.current) return null;
      setError(lottoApi.getErrorMessage(apiError, 'Failed to fetch active round'));
      setActiveRound(null);
      activeRoundRef.current = null;
      return null;
    }
  }, []);

  const selectCategory = useCallback(
    (nextCategory) => {
      const normalized = VALID_CATEGORIES.has(nextCategory)
        ? nextCategory
        : DEFAULT_CATEGORY;
      categoryRef.current = normalized;
      setCategory(normalized);
      return getActiveRound(normalized);
    },
    [getActiveRound],
  );

  const getHistory = useCallback(
    async ({ limit = 20, offset = 0, append = false, status, category } = {}) => {
      const targetCategory = category ?? historyCategoryRef.current;
      historyCategoryRef.current = targetCategory;
      if (!isAuthenticated || !userId) {
        if (!isMountedRef.current) return [];

        setHistory([]);
        setHistoryMeta({
          total: 0,
          limit,
          offset: 0,
          hasMore: false,
        });

        return [];
      }

      if (isMountedRef.current) {
        setHistoryLoading(true);
        setHistoryError(null);
      }

      try {
        const response = await lottoApi.getMyTickets({ limit, offset, status, category: targetCategory });
        if (!isMountedRef.current) return [];

        const items = Array.isArray(response.items)
          ? response.items.map(normalizeHistoryTicketForUi).filter(Boolean)
          : [];

        setHistory((previous) => {
          if (!append) return items;

          const merged = [...previous, ...items].reduce((accumulator, currentItem) => {
            if (!accumulator.some((item) => item.id === currentItem.id)) {
              accumulator.push(currentItem);
            }

            return accumulator;
          }, []);

          return merged;
        });

        const total = Number(response.total ?? 0);
        const normalizedLimit = Number(response.limit ?? limit);
        const normalizedOffset = Number(response.offset ?? offset);
        const hasMore = normalizedOffset + items.length < total;

        setHistoryMeta({
          total,
          limit: normalizedLimit,
          offset: normalizedOffset,
          hasMore,
        });

        return items;
      } catch (apiError) {
        if (!isMountedRef.current) return [];

        const message = lottoApi.getErrorMessage(apiError, 'Failed to fetch ticket history');
        setHistoryError(message);
        setError(message);

        if (!append) {
          setHistory([]);
          setHistoryMeta({
            total: 0,
            limit,
            offset: 0,
            hasMore: false,
          });
        }

        return [];
      } finally {
        if (isMountedRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    [isAuthenticated, userId],
  );

  const getLastResult = useCallback(
    async ({ limit = 10, offset = 0, append = false, category } = {}) => {
      // Results follow the selected timer category so each page shows
      // exactly `limit` draws for that category (server-side filter).
      const targetCategory = category ?? categoryRef.current;
      if (isMountedRef.current) {
        setResultsLoading(true);
        setResultsError(null);
      }

      try {
        const response = await lottoApi.getRecentResults({
          limit,
          offset,
          category: targetCategory,
        });
      if (!isMountedRef.current) return [];

      const items = Array.isArray(response.items)
        ? response.items.map(normalizeResultForUi).filter(Boolean)
        : [];

      setRecentResults((previous) => {
        if (!append) return items;

        const merged = [...previous, ...items].reduce((accumulator, currentItem) => {
          if (!accumulator.some((item) => item.id === currentItem.id)) {
            accumulator.push(currentItem);
          }

          return accumulator;
        }, []);

        return merged;
      });

      if (!append) {
        setLastResult(items[0] ?? null);
      }

      const total = Number(response.total ?? 0);
      const normalizedLimit = Number(response.limit ?? limit);
      const normalizedOffset = Number(response.offset ?? offset);
      const hasMore = normalizedOffset + items.length < total;

      setResultsMeta({
        total,
        limit: normalizedLimit,
        offset: normalizedOffset,
        hasMore,
      });

      return items;
    } catch (apiError) {
      if (!isMountedRef.current) return [];

      const message = lottoApi.getErrorMessage(apiError, 'Failed to fetch recent results');
      setResultsError(message);
      setError(message);

      if (!append) {
        setRecentResults([]);
        setLastResult(null);
        setResultsMeta({ total: 0, limit, offset: 0, hasMore: false });
      }

      return [];
    } finally {
      if (isMountedRef.current) {
        setResultsLoading(false);
      }
    }
  }, []);

  const getTicketDetail = useCallback(async (ticketId) => {
    const normalizedTicketId = Number(ticketId);

    if (!Number.isFinite(normalizedTicketId) || normalizedTicketId <= 0) {
      if (isMountedRef.current) {
        setTicketDetail(null);
      }
      return null;
    }

    if (isMountedRef.current) {
      setTicketDetailLoading(true);
      setTicketDetailError(null);
    }

    try {
      const response = await lottoApi.getTicketById(normalizedTicketId);
      const normalized = normalizeHistoryTicketForUi(response.ticket);

      if (isMountedRef.current) {
        setTicketDetail(normalized);
      }

      return normalized;
    } catch (apiError) {
      const message = lottoApi.getErrorMessage(apiError, 'Failed to fetch ticket details');

      if (isMountedRef.current) {
        setTicketDetail(null);
        setTicketDetailError(message);
      }

      return null;
    } finally {
      if (isMountedRef.current) {
        setTicketDetailLoading(false);
      }
    }
  }, []);

  const refreshLottoState = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const tasks = [getActiveRound(), getLastResult({ limit: 5, offset: 0, append: false })];

      if (isAuthenticated && userId) {
        tasks.push(fetchBalance(), getHistory({ limit: 5, offset: 0, append: false }));
      } else if (isMountedRef.current) {
        setHistory([]);
      }

      await Promise.all(tasks);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchBalance, getActiveRound, getHistory, getLastResult, isAuthenticated, userId]);

  const placeBet = useCallback(
    async (roundId, numbers, amount) => {
      setPlacingBet(true);
      setError(null);

      try {
        if (!isAuthenticated || !userId) {
          throw new Error('Please connect and authenticate wallet first.');
        }

        const currentRound = activeRoundRef.current;
        const currentRoundId = Number(currentRound?.id);
        const targetRoundId = Number(roundId || currentRoundId);

        if (!Number.isFinite(targetRoundId) || targetRoundId <= 0) {
          throw new Error('No active round available for betting');
        }

        const betAmount = Number(amount);
        if (!Number.isFinite(betAmount) || betAmount <= 0) {
          throw new Error('Invalid bet amount');
        }

        const normalizedAmount = clamp(betAmount, 1, 100_000);
        const selectedNumbers = normalizeSelection(numbers);

        if (selectedNumbers.length === 0) {
          throw new Error('Please select at least one number');
        }

        const purchaseSignature = toPurchaseSignature(
          targetRoundId,
          selectedNumbers,
          normalizedAmount,
        );

        if (
          pendingPurchaseRef.current &&
          pendingPurchaseRef.current.signature !== purchaseSignature
        ) {
          throw new Error('Another ticket purchase is already in progress. Please wait.');
        }

        const nowMs = Date.now();
        pruneExpiredIdempotencyCache(idempotencyCacheRef.current, nowMs);

        const pendingForSameSignature =
          pendingPurchaseRef.current?.signature === purchaseSignature
            ? pendingPurchaseRef.current
            : null;

        const cachedEntry = idempotencyCacheRef.current.get(purchaseSignature);

        const idempotencyKey =
          pendingForSameSignature?.idempotencyKey ||
          cachedEntry?.idempotencyKey ||
          buildIdempotencyKey(targetRoundId, selectedNumbers, normalizedAmount);

        idempotencyCacheRef.current.set(purchaseSignature, {
          idempotencyKey,
          createdAtMs: nowMs,
        });

        pendingPurchaseRef.current = {
          signature: purchaseSignature,
          idempotencyKey,
        };

        const response = await lottoApi.placeTicket({
          roundId: targetRoundId,
          amount: normalizedAmount,
          selectedNumbers,
          idempotencyKey,
        });

        const ticket = normalizeHistoryTicketForUi(response.ticket);

        if (isMountedRef.current && ticket) {
          setLatestTicket(ticket);
          setTicketDetail(ticket);

          setHistory((previous) => {
            const deduped = previous.filter((item) => item.id !== ticket.id);
            return [ticket, ...deduped].slice(0, 20);
          });
        }

        await Promise.all([
          fetchBalance(),
          getHistory({ limit: 5, offset: 0, append: false }),
          getLastResult({ limit: 5, offset: 0, append: false }),
          getActiveRound(),
        ]);

        return {
          success: true,
          data: ticket,
        };
      } catch (apiError) {
        const message = lottoApi.getErrorMessage(apiError, 'Failed to place ticket');

        if (isMountedRef.current) {
          setError(message);
        }

        return {
          success: false,
          error: message,
        };
      } finally {
        pendingPurchaseRef.current = null;

        if (isMountedRef.current) {
          setPlacingBet(false);
        }
      }
    },
    [fetchBalance, getActiveRound, getHistory, getLastResult, isAuthenticated, userId],
  );

  useEffect(() => {
    isMountedRef.current = true;

    void refreshLottoState();

    pollRef.current = window.setInterval(() => {
      void refreshLottoState();
    }, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;

      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [refreshLottoState]);

  return {
    loading: loading || placingBet,
    placingBet,
    balance,
    activeRound,
    category,
    controls,
    error,

    history,
    historyMeta,
    historyLoading,
    historyError,

    recentResults,
    lastResult,
    resultsMeta,
    resultsLoading,
    resultsError,

    ticketDetail,
    ticketDetailLoading,
    ticketDetailError,
    latestTicket,

    isAuthenticated,

    fetchBalance,
    refreshLottoState,
    getActiveRound,
    selectCategory,
    getHistory,
    getLastResult,
    getTicketDetail,
    placeBet,

    clearTicketDetail: () => {
      if (!isMountedRef.current) return;
      setTicketDetail(null);
      setTicketDetailError(null);
    },
  };
};