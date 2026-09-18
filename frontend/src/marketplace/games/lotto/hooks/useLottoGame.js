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

// 5s steady refresh for round/results/history/balance. The draw result
// itself is caught up faster via the bounded post-draw poll in
// LottoGame.handleRoundExpire — this interval is only the fallback.
const POLL_INTERVAL_MS = 5_000;
const IDEMPOTENCY_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_CONTROLS = {
  paused: false,
  resultMode: 'SERVER_RANDOM',
};

// Backend Category enum: THIRTY_SEC | ONE_MIN | THREE_MIN | FIVE_MIN
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

  const result = Math.max(0, Math.floor((cutoffAtMs - Date.now()) / 1000));

  return result;
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

  // HIGH-001 fix: separate INITIAL loading from BACKGROUND refreshing.
  // `loading` is now ONLY the first blocking load (before any round data
  // exists) — it may show a skeleton and lock the UI. Every background poll
  // sets `isRefreshing` instead, which never dims the grid, never flashes
  // content and never clears visible UI state. Poll interval and API calls
  // are unchanged.
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [placingBet, setPlacingBet] = useState(false);
  const [activeRound, setActiveRound] = useState(null);
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [history, setHistory] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  // Result ALREADY PRE-COMPUTED by the backend for the round in its cutoff
  // window (betting closed, draw not reached). Cached so the 00:00 reveal needs
  // no API call at all — see fetchPendingResult().
  const [pendingResult, setPendingResult] = useState(null);
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

  // Win/Loss settlement popup (shared WinLossPopup component)
  const [settlementPopup, setSettlementPopup] = useState(null);
  const notifiedTicketIdsRef = useRef(new Set());
  const sessionStartedAtRef = useRef(Date.now());

  const isMountedRef = useRef(false);
  const pollRef = useRef(null);
  // HIGH-002: holds the latest refreshLottoState so the 5s poll interval
  // never depends on callback identity (wallet balance churn used to tear
  // down and recreate the interval, firing an extra 4-call burst each time).
  const refreshLottoStateRef = useRef(null);
  // HIGH-001: flips once after the first refreshLottoState completes; every
  // later call is a background refresh (isRefreshing), never a blocking load.
  const hasCompletedInitialLoadRef = useRef(false);
  const activeRoundRef = useRef(null);
  const categoryRef = useRef(DEFAULT_CATEGORY);
  const historyCategoryRef = useRef(DEFAULT_CATEGORY);
  const idempotencyCacheRef = useRef(new Map());
  const pendingPurchaseRef = useRef(null);
  // Client/server clock offset (ms). serverNow = Date.now() + serverOffsetRef.
  // Lets the countdown stay correct even if the user's local clock is wrong.
  const serverOffsetRef = useRef(0);
  // Per-category caches: every duration tab owns its OWN round + recent
  // results. Switching tabs instantly applies that category's cached data,
  // so the timer/period/results can never mix across durations.
  const roundsByCategoryRef = useRef(new Map());
  const resultsByCategoryRef = useRef(new Map());
  // Per-category pre-reveal cache: the value prepared for the round whose
  // cutoff window is currently open. Keyed by category so switching tabs can
  // never leak another duration's not-yet-revealed result.
  const pendingByCategoryRef = useRef(new Map());
  // Monotonic fetch tokens: only the LATEST fetch for the CURRENTLY selected
  // category may write visible state. A slow in-flight response for a
  // previously selected tab can never leak into the current view.
  const roundFetchTokenRef = useRef(0);
  const resultsFetchTokenRef = useRef(0);
  const historyFetchTokenRef = useRef(0);

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
      // HIGH-002: the poll is a BACKGROUND refresh — silent keeps `isLoading`
      // (part of the wallet context value) untouched, so the 5s poll can no
      // longer re-render every wallet consumer twice per cycle.
      await refreshWallet({ silent: true });
    } catch (apiError) {
      if (!isMountedRef.current) return;
      setError(lottoApi.getErrorMessage(apiError, 'Failed to fetch wallet balance'));
    }
  }, [isAuthenticated, refreshWallet, userId]);

  const getActiveRound = useCallback(async (categoryOverride) => {
    const targetCategory = categoryOverride ?? categoryRef.current;
    const fetchToken = ++roundFetchTokenRef.current;
    try {
      const response = await lottoApi.getActiveRound(
        targetCategory ? { category: targetCategory } : undefined,
      );
      if (!isMountedRef.current) return null;

      const normalizedRound = normalizeRoundForUi(response.round);

      setControls(response.controls ?? DEFAULT_CONTROLS);

      // Cache per category — even a stale-token response is still valid data
      // for its own tab and keeps it warm for instant switching.
      if (normalizedRound && normalizedRound.id) {
        roundsByCategoryRef.current.set(targetCategory, normalizedRound);
      }

      // Only the LATEST fetch for the CURRENTLY SELECTED category may update
      // visible state — prevents cross-category overwrites and timer resets.
      if (
        fetchToken === roundFetchTokenRef.current &&
        categoryRef.current === targetCategory &&
        normalizedRound &&
        normalizedRound.id
      ) {
        setActiveRound(normalizedRound);
        activeRoundRef.current = normalizedRound;
      }

      // Compute client/server clock offset from authoritative server time so
      // the countdown is independent of the user's local clock. (Clock offset
      // is category-independent — shared across all tabs.)
      const serverNowMs = response.serverNow ? new Date(response.serverNow).getTime() : null;
      if (Number.isFinite(serverNowMs)) {
        serverOffsetRef.current = serverNowMs - Date.now();
      }

      return normalizedRound;
    } catch (apiError) {
      if (!isMountedRef.current) return null;
      // Only surface the error if this fetch is still relevant. Do NOT null
      // the active round — the canonical timer expires it and retries, and
      // the per-category cache keeps the tab stable.
      if (fetchToken === roundFetchTokenRef.current && categoryRef.current === targetCategory) {
        setError(lottoApi.getErrorMessage(apiError, 'Failed to fetch active round'));
      }
      return null;
    }
  }, []);

  const getHistory = useCallback(
    async ({ limit = 20, offset = 0, append = false, status, category } = {}) => {
      const targetCategory = category ?? historyCategoryRef.current;
      historyCategoryRef.current = targetCategory;
      const fetchToken = ++historyFetchTokenRef.current;
      const applyToken = () => fetchToken === historyFetchTokenRef.current;
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

        if (applyToken()) {
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
        }

        return items;
      } catch (apiError) {
        if (!isMountedRef.current) return [];

        const message = lottoApi.getErrorMessage(apiError, 'Failed to fetch ticket history');

        if (applyToken()) {
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
      const fetchToken = ++resultsFetchTokenRef.current;
      const isRecentPage = !append && offset === 0;
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

        const total = Number(response.total ?? 0);
        const normalizedLimit = Number(response.limit ?? limit);
        const normalizedOffset = Number(response.offset ?? offset);
        const hasMore = normalizedOffset + items.length < total;

        // Cache the canonical "recent" page per category so tab switches
        // instantly show THIS category's own result balls (never another
        // duration's results).
        if (isRecentPage) {
          resultsByCategoryRef.current.set(targetCategory, {
            items,
            meta: { total, limit: normalizedLimit, offset: normalizedOffset, hasMore },
          });
        }

        // Only the LATEST fetch for the CURRENTLY selected category may
        // update visible state — prevents cross-category result mixing.
        if (
          fetchToken === resultsFetchTokenRef.current &&
          categoryRef.current === targetCategory
        ) {
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

          setResultsMeta({
            total,
            limit: normalizedLimit,
            offset: normalizedOffset,
            hasMore,
          });
        }

        return items;
      } catch (apiError) {
        if (!isMountedRef.current) return [];

        const message = lottoApi.getErrorMessage(apiError, 'Failed to fetch recent results');

        if (
          fetchToken === resultsFetchTokenRef.current &&
          categoryRef.current === targetCategory
        ) {
          setResultsError(message);
          setError(message);

          if (!append) {
            setRecentResults([]);
            setLastResult(null);
            setResultsMeta({ total: 0, limit, offset: 0, hasMore: false });
          }
        }

        return [];
      } finally {
        if (isMountedRef.current) {
          setResultsLoading(false);
        }
      }
    },
    [],
  );

  /**
   * Fetches the PRE-COMPUTED result for the round that is currently in its
   * cutoff window and caches it per category.
   *
   * Returns the cached entry `{ roundId, roundNumber, result, revealAt }` or
   * null when the backend has nothing pending (outside the window / no round).
   *
   * The reveal path reads this cache, never the network: at 00:00 the UI flips
   * to this value instantly. It also refreshes the client/server clock offset
   * from `serverNow`, keeping the countdown and the reveal on server time.
   */
  const fetchPendingResult = useCallback(async (categoryOverride) => {
    const targetCategory = categoryOverride ?? categoryRef.current;

    try {
      const response = await lottoApi.getPendingResult({ category: targetCategory });

      if (!isMountedRef.current) return null;

      // Keep the server clock offset fresh — the reveal is gated on server time.
      const serverNowMs = response?.serverNow ? new Date(response.serverNow).getTime() : null;
      if (Number.isFinite(serverNowMs)) {
        serverOffsetRef.current = serverNowMs - Date.now();
      }

      const pending = response?.pendingResult ?? null;
      const entry = pending && pending.roundId != null && pending.result
        ? {
            roundId: pending.roundId,
            roundNumber: pending.roundNumber,
            category: pending.category ?? targetCategory,
            result: pending.result,
            status: pending.status ?? 'RESULTED',
            resultSource: pending.resultSource ?? null,
            revealAt: pending.revealAt ?? pending.drawAt ?? null,
            drawAt: pending.drawAt ?? pending.revealAt ?? null,
            // Set below from the response clock — used by the UI to decide
            // "has the reveal instant arrived yet?" without a new request.
            receivedAtMs: Date.now() + serverOffsetRef.current,
          }
        : null;

      if (entry) {
        pendingByCategoryRef.current.set(targetCategory, entry);
      } else {
        // Window closed (or the round was already drawn) — drop the stale entry
        // so an old period can never be revealed as if it were the new one.
        pendingByCategoryRef.current.delete(targetCategory);
      }

      if (categoryRef.current === targetCategory) {
        setPendingResult(entry);
      }

      return entry;
    } catch (apiError) {
      if (!isMountedRef.current) return null;

      if (categoryRef.current === targetCategory) {
        setError(lottoApi.getErrorMessage(apiError, 'Failed to fetch pending result'));
      }

      return null;
    }
  }, []);

  // Category switch = the WHOLE game context switches at once. The selected
  // duration determines: timer round, current period, recent results, betting
  // lock and the Buy Card roundId. Cached data is applied SYNCHRONOUSLY so
  // the UI can never briefly show another duration's period/timer/results,
  // then a background fetch refreshes this category's real backend data.
  const selectCategory = useCallback(
    (nextCategory) => {
      const normalized = VALID_CATEGORIES.has(nextCategory)
        ? nextCategory
        : DEFAULT_CATEGORY;

      if (categoryRef.current === normalized) {
        // Same tab re-selected — just refresh in the background.
        void getActiveRound(normalized);
        void getLastResult({ limit: 5, offset: 0, append: false, category: normalized });
        return;
      }

      categoryRef.current = normalized;
      setCategory(normalized);

      // 1) Instant synchronous switch to THIS category's cached round and
      //    results (single source of truth for timer + period + Buy Card).
      const cachedRound = roundsByCategoryRef.current.get(normalized) ?? null;
      activeRoundRef.current = cachedRound;
      setActiveRound(cachedRound);

      const cachedResults = resultsByCategoryRef.current.get(normalized);
      if (cachedResults) {
        setRecentResults(cachedResults.items);
        setLastResult(cachedResults.items[0] ?? null);
        setResultsMeta(cachedResults.meta);
      } else {
        setRecentResults([]);
        setLastResult(null);
        setResultsMeta({ total: 0, limit: 20, offset: 0, hasMore: false });
      }

      // Pre-reveal cache follows the tab too: the newly selected category's own
      // prepared value (or none) — never the previous tab's.
      const cachedPending = pendingByCategoryRef.current.get(normalized) ?? null;
      setPendingResult(cachedPending);

      // 2) Fresh backend data for the newly selected category.
      void getActiveRound(normalized);
      void getLastResult({ limit: 5, offset: 0, append: false, category: normalized });
    },
    [getActiveRound, getLastResult],
  );

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
    // HIGH-001 fix: only the FIRST blocking load (before any round data has
    // ever arrived in this session) toggles `loading`. Every background poll
    // toggles `isRefreshing` instead — which no consumer treats as a
    // blocking/visual state, so the grid never dims mid-session.
    // Tracked via a ref (NOT state/props) so refreshLottoState's identity —
    // and therefore the 5s poll interval subscription — stays as stable as
    // before (no new effect re-subscribes).
    const isFirstLoad = !hasCompletedInitialLoadRef.current;
    if (isMountedRef.current) {
      if (isFirstLoad) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
    }
    if (isFirstLoad) {
      setError(null);
    }

    try {
      const tasks = [getActiveRound(), getLastResult({ limit: 5, offset: 0, append: false })];

      if (isAuthenticated && userId) {
        tasks.push(fetchBalance(), getHistory({ limit: 5, offset: 0, append: false }));
      } else if (isMountedRef.current) {
        // Unauthenticated session: never keep another session's ticket list
        // (original behaviour). Runs on logout too, where the poll effect
        // re-subscribes on the isAuthenticated change.
        setHistory([]);
      }

      await Promise.all(tasks);
    } finally {
      if (isFirstLoad) {
        hasCompletedInitialLoadRef.current = true;
      }
      if (isMountedRef.current) {
        if (isFirstLoad) {
          setLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    }
  }, [fetchBalance, getActiveRound, getHistory, getLastResult, isAuthenticated, userId]);

  // HIGH-002: keep the latest refreshLottoState in a ref. Declared BEFORE
  // the poll effect so, on any render where both run, the ref is already
  // updated when the interval (re)subscribes.
  useEffect(() => {
    refreshLottoStateRef.current = refreshLottoState;
  }, [refreshLottoState]);

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

  // ============================================================
  // WIN/LOSS SETTLEMENT POPUP
  // ============================================================
  // Fires when one of the user's tickets settles with WIN/LOSS
  // AFTER this screen session started (session filter prevents
  // spamming popups from old history rows on first load).
  // One popup at a time — the first newly-settled ticket wins.
  // ============================================================

  useEffect(() => {
    if (!isMountedRef.current || !Array.isArray(history) || history.length === 0) {
      return;
    }

    for (const ticket of history) {
      if (!ticket?.isSettled || !ticket?.id) {
        continue;
      }

      const settledAtMs = new Date(
        ticket.settledAt ?? ticket.updatedAt ?? 0,
      ).getTime();

      if (
        !Number.isFinite(settledAtMs) ||
        settledAtMs < sessionStartedAtRef.current
      ) {
        continue;
      }

      if (notifiedTicketIdsRef.current.has(ticket.id)) {
        continue;
      }

      notifiedTicketIdsRef.current.add(ticket.id);

      const won = Boolean(ticket.isWin);
      const stake = Number(ticket.amount ?? 0);
      const winAmount = Number(ticket.winAmount ?? 0);

      const formatTdx = (value) =>
        Number(value ?? 0).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      setSettlementPopup({
        id: String(ticket.id),
        outcome: won ? 'win' : 'loss',
        title: won ? '🎉 Ticket Won!' : 'No Win This Round',
        detail: `Round ${ticket.roundNumber ?? '—'} • ${ticket.selectedNumbers?.length ?? 0} numbers`,
        amount: won
          ? `+${formatTdx(winAmount)} TDX`
          : `${formatTdx(stake)} TDX`,
        meta: won
          ? 'Winnings credited to your wallet'
          : 'Better luck next round!',
      });

      break;
    }
  }, [history]);

  useEffect(() => {
    isMountedRef.current = true;

    void refreshLottoStateRef.current();

    pollRef.current = window.setInterval(() => {
      void refreshLottoStateRef.current();
    }, POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;

      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
    // HIGH-002: keyed on session identity only (userId / auth state). The
    // callback itself is read through the ref, so wallet-balance churn can
    // no longer tear down and recreate the interval mid-session.
  }, [userId, isAuthenticated]);

  return {
    loading: loading || placingBet,
    isRefreshing,
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

    // Pre-computed result awaiting its 00:00 reveal (cutoff window only).
    pendingResult,
    fetchPendingResult,

    ticketDetail,
    ticketDetailLoading,
    ticketDetailError,
    latestTicket,

    settlementPopup,

    dismissSettlementPopup: () => {
      if (!isMountedRef.current) return;
      setSettlementPopup(null);
    },

    isAuthenticated,

    fetchBalance,
    refreshLottoState,
    getActiveRound,
    selectCategory,
    getHistory,
    getLastResult,
    getTicketDetail,
    placeBet,
    // Server-synchronized "now" (ms). Falls back to Date.now() if unknown.
    getServerNow: () => Date.now() + serverOffsetRef.current,

    clearTicketDetail: () => {
      if (!isMountedRef.current) return;
      setTicketDetail(null);
      setTicketDetailError(null);
    },
  };
};