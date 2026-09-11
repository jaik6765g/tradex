// ============================================================
// PULSE TRADE HOOK
// BACKEND-AUTHORITATIVE LIFECYCLE
// REAL-TIME BALANCE + OPEN TRADE + HISTORY REFRESH
// ============================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useWalletContext } from '../../../wallet/context/WalletContext';
import { PulseTradeService } from '../services/pulseTrade.service';

import type {
  PlacePulseTradeResponse,
  PulseDirection,
  PulseDuration,
  PulseHistoryTrade,
  PulseOpenTrade,
  PulsePair,
  PulsePortfolioResponse,
  PulsePriceResponse,
  PulseRiskResponse,
} from '../types';

import {
  PULSE_MAX_AMOUNT_TDX,
  PULSE_MIN_AMOUNT_TDX,
  PULSE_SUPPORTED_DURATIONS,
  PULSE_SUPPORTED_PAIRS,
} from '../types';

import type { WinLossPopupData } from '../../../shared/components/WinLossPopup';

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_PAIR: PulsePair = 'BTC/USDT';

const DEFAULT_DURATION: PulseDuration = '1M';

const DEFAULT_DIRECTION: PulseDirection = 'LONG';

const DEFAULT_AMOUNT = '100';

// ============================================================
// POLLING
// ============================================================
//
// Every 3 seconds the frontend checks:
//
// 1. Current market price
// 2. Open trades
// 3. Trade history
// 4. Portfolio
// 5. Wallet balance
//
// This is important because settlement happens on the backend.
// After settlement the wallet balance can change without a page
// reload.
//
const OPEN_REFRESH_MS = 3000;

// ============================================================
// UI MESSAGE
// ============================================================

type UiMessageType =
  | 'success'
  | 'error'
  | 'info';

type UiMessage = {
  type: UiMessageType;
  text: string;
} | null;

// ============================================================
// AMOUNT VALIDATION
// ============================================================
//
// Maximum 8 decimal places.
// Example:
// 10
// 10.5
// 10.12345678
//
// Invalid:
// 10.
// 10.123456789
// abc
//
const amountRegex =
  /^\d+(\.\d{0,8})?$/;

// ============================================================
// HOOK
// ============================================================

export function usePulseTrade() {
  // ==========================================================
  // WALLET CONTEXT
  // ==========================================================

  const {
    isAuthenticated,
    userId,
    balance,
    refresh: refreshWallet,
  } = useWalletContext();

  // ==========================================================
  // TRADE FORM STATE
  // ==========================================================

  const [
    selectedPair,
    setSelectedPair,
  ] = useState<PulsePair>(
    DEFAULT_PAIR,
  );

  const [
    selectedDuration,
    setSelectedDuration,
  ] = useState<PulseDuration>(
    DEFAULT_DURATION,
  );

  const [
    selectedDirection,
    setSelectedDirection,
  ] = useState<PulseDirection>(
    DEFAULT_DIRECTION,
  );

  const [
    amountInput,
    setAmountInput,
  ] = useState<string>(
    DEFAULT_AMOUNT,
  );

  // ==========================================================
  // MARKET STATE
  // ==========================================================

  const [
    markets,
    setMarkets,
  ] = useState<PulsePair[]>([
    DEFAULT_PAIR,
  ]);

  const [
    currentPrice,
    setCurrentPrice,
  ] = useState<PulsePriceResponse | null>(
    null,
  );

  // ==========================================================
  // TRADE STATE
  // ==========================================================

  const [
    openTrades,
    setOpenTrades,
  ] = useState<PulseOpenTrade[]>([]);

  const [
    history,
    setHistory,
  ] = useState<PulseHistoryTrade[]>([]);

  const [
    portfolio,
    setPortfolio,
  ] = useState<PulsePortfolioResponse | null>(
    null,
  );

  const [
    risk,
    setRisk,
  ] = useState<PulseRiskResponse | null>(
    null,
  );

  const [
    lastPlaced,
    setLastPlaced,
  ] = useState<PlacePulseTradeResponse | null>(
    null,
  );

  const [
    activeTradeDetail,
    setActiveTradeDetail,
  ] = useState<
    PlacePulseTradeResponse['trade'] | null
  >(null);

  // ==========================================================
  // UI STATE
  // ==========================================================

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    placingTrade,
    setPlacingTrade,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState<UiMessage>(null);

  // ==========================================================
  // SETTLEMENT POPUP (WIN/LOSS/DRAW)
  // ==========================================================

  const [
    settlementPopup,
    setSettlementPopup,
  ] = useState<WinLossPopupData | null>(
    null,
  );

  // ==========================================================
  // REFS
  // ==========================================================

  const pollRef =
    useRef<number | null>(null);

  const clientRequestIdRef =
    useRef<string | null>(null);

  // Settlement popup refs — only trades that settle AFTER this
  // screen session started trigger a popup (no old-history spam),
  // and each trade id notifies at most once.
  const notifiedTradeIdsRef =
    useRef<Set<string>>(new Set());

  const sessionStartedAtRef =
    useRef(Date.now());

  // ==========================================================
  // ACTIVE TRADE
  // ==========================================================

  const activeTrade = useMemo(
    () => openTrades[0] ?? null,
    [openTrades],
  );

  // ==========================================================
  // LOAD TRADE DETAIL
  // ==========================================================

  const loadTradeDetail =
    useCallback(
      async (tradeId: string) => {
        try {
          const detail =
            await PulseTradeService.getTradeById(
              tradeId,
            );

          setActiveTradeDetail(
            detail.trade,
          );
        } catch {
          setActiveTradeDetail(
            null,
          );
        }
      },
      [],
    );

  // ==========================================================
  // INITIAL DATA LOAD
  // ==========================================================

  const loadInitialData =
    useCallback(
      async () => {
        // ----------------------------------------------------
        // Not authenticated
        // ----------------------------------------------------

        if (
          !isAuthenticated ||
          !userId
        ) {
          setOpenTrades([]);
          setHistory([]);
          setPortfolio(null);
          setRisk(null);
          setCurrentPrice(null);
          setMarkets([DEFAULT_PAIR]);
          setActiveTradeDetail(null);

          return;
        }

        setLoading(true);

        try {
          const [
            marketsRes,
            priceRes,
            openRes,
            historyRes,
            portfolioRes,
            riskRes,
          ] = await Promise.all([
            // Markets
            PulseTradeService.getMarkets(),

            // Current selected pair price
            PulseTradeService.getMarketPrice(
              selectedPair,
            ),

            // Active trades
            PulseTradeService.getOpenTrades(),

            // Recent history
            PulseTradeService.getTradeHistory({
              limit: 20,
              offset: 0,
            }),

            // Portfolio
            PulseTradeService.getPortfolio(),

            // Risk
            PulseTradeService.getRisk(),
          ]);

          // --------------------------------------------------
          // Normalize supported markets
          // --------------------------------------------------

          const contractMarkets =
            marketsRes.markets
              .map(
                (market) =>
                  market.symbol,
              )
              .filter(
                (
                  symbol,
                ): symbol is PulsePair =>
                  PULSE_SUPPORTED_PAIRS.includes(
                    symbol as PulsePair,
                  ),
              );

          setMarkets(
            contractMarkets.length > 0
              ? contractMarkets
              : [
                  ...PULSE_SUPPORTED_PAIRS,
                ],
          );

          // --------------------------------------------------
          // Set market state
          // --------------------------------------------------

          setCurrentPrice(
            priceRes,
          );

          // --------------------------------------------------
          // Set trade state
          // --------------------------------------------------

          setOpenTrades(
            openRes.trades,
          );

          setHistory(
            historyRes.trades,
          );

          setPortfolio(
            portfolioRes,
          );

          setRisk(
            riskRes,
          );

          // --------------------------------------------------
          // IMPORTANT
          //
          // Also refresh global wallet balance on initial
          // Pulse screen load.
          // --------------------------------------------------

          try {
            await refreshWallet();
          } catch {
            // Keep current wallet state if wallet refresh fails.
          }
        } catch (error) {
          const parsed =
            PulseTradeService.parseApiError(
              error,
            );

          const text =
            parsed.message ||
            'Failed to load pulse trade data';

          setMessage({
            type: 'error',
            text,
          });
        } finally {
          setLoading(false);
        }
      },
      [
        isAuthenticated,
        userId,
        selectedPair,
        refreshWallet,
      ],
    );

  // ==========================================================
  // REFRESH OPEN STATE
  // ==========================================================
  //
  // THIS IS THE IMPORTANT FIX.
  //
  // Settlement happens in backend.
  //
  // Example:
  //
  // OPEN
  //   ↓
  // expiresAt reached
  //   ↓
  // backend settlement
  //   ↓
  // wallet balance changes
  //   ↓
  // open trade disappears
  //   ↓
  // history changes
  //   ↓
  // refreshWallet()
  //   ↓
  // UI shows latest balance
  //
  // No page refresh required.
  //
  const refreshOpenState =
    useCallback(
      async () => {
        if (
          !isAuthenticated ||
          !userId
        ) {
          return;
        }

        // ====================================================
        // PULSE STATE REFRESH
        // ====================================================

        try {
          const [
            priceRes,
            openRes,
            historyRes,
            portfolioRes,
          ] = await Promise.all([
            // Current market price
            PulseTradeService.getMarketPrice(
              selectedPair,
            ),

            // Active/open trades
            PulseTradeService.getOpenTrades(),

            // Settled trade history
            PulseTradeService.getTradeHistory({
              limit: 20,
              offset: 0,
            }),

            // Portfolio
            PulseTradeService.getPortfolio(),
          ]);

          setCurrentPrice(
            priceRes,
          );

          setOpenTrades(
            openRes.trades,
          );

          setHistory(
            historyRes.trades,
          );

          setPortfolio(
            portfolioRes,
          );
        } catch {
          // --------------------------------------------------
          // IMPORTANT:
          //
          // Do not clear existing state if a polling request
          // temporarily fails.
          //
          // Keep the last known good state.
          // --------------------------------------------------
        }

        // ====================================================
        // WALLET BALANCE REFRESH
        // ====================================================
        //
        // This is deliberately independent from the Pulse API
        // Promise above.
        //
        // If Pulse API fails, wallet can still refresh.
        //
        // If wallet API fails, Pulse state remains intact.
        //
        try {
          await refreshWallet();
        } catch {
          // Keep last known wallet balance.
        }
      },
      [
        isAuthenticated,
        userId,
        selectedPair,
        refreshWallet,
      ],
    );

  // ==========================================================
  // VALIDATE TRADE INPUT
  // ==========================================================

  const validateTradeInput =
    useCallback(
      (): string | null => {
        // ----------------------------------------------------
        // Pair
        // ----------------------------------------------------

        if (
          !PULSE_SUPPORTED_PAIRS.includes(
            selectedPair,
          )
        ) {
          return (
            'Invalid trading pair selected.'
          );
        }

        // ----------------------------------------------------
        // Duration
        // ----------------------------------------------------

        if (
          !PULSE_SUPPORTED_DURATIONS.includes(
            selectedDuration,
          )
        ) {
          return (
            'Invalid duration selected.'
          );
        }

        // ----------------------------------------------------
        // Direction
        // ----------------------------------------------------

        if (
          selectedDirection !==
            'LONG' &&
          selectedDirection !==
            'SHORT'
        ) {
          return (
            'Invalid direction selected.'
          );
        }

        // ----------------------------------------------------
        // Amount
        // ----------------------------------------------------

        const normalizedAmount =
          amountInput.trim();

        if (
          !amountRegex.test(
            normalizedAmount,
          )
        ) {
          return (
            'Enter a valid amount (up to 8 decimals).'
          );
        }

        const amount =
          Number(
            normalizedAmount,
          );

        if (
          !Number.isFinite(
            amount,
          )
        ) {
          return (
            'Enter a valid amount.'
          );
        }

        // ----------------------------------------------------
        // Minimum
        // ----------------------------------------------------

        if (
          amount <
          PULSE_MIN_AMOUNT_TDX
        ) {
          return `Minimum amount is ${PULSE_MIN_AMOUNT_TDX} TDX.`;
        }

        // ----------------------------------------------------
        // Maximum
        // ----------------------------------------------------

        if (
          amount >
          PULSE_MAX_AMOUNT_TDX
        ) {
          return `Maximum amount is ${PULSE_MAX_AMOUNT_TDX.toLocaleString()} TDX.`;
        }

        return null;
      },
      [
        amountInput,
        selectedDirection,
        selectedDuration,
        selectedPair,
      ],
    );

  // ==========================================================
  // PLACE TRADE
  // ==========================================================

  const placeTrade =
    useCallback(
      async (
        directionOverride?: PulseDirection,
      ) => {
        // ----------------------------------------------------
        // Resolve direction
        //
        // The caller may pass the direction explicitly at
        // click time (LONG/SHORT buttons). This avoids the
        // stale-closure bug where setSelectedDirection('SHORT')
        // followed by an immediate placeTrade() would still read
        // the PREVIOUS render's selectedDirection and place the
        // WRONG side of the trade.
        // ----------------------------------------------------

        const direction =
          directionOverride ?? selectedDirection;

        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        if (
          !isAuthenticated ||
          !userId
        ) {
          setMessage({
            type: 'error',
            text:
              'Please connect and authenticate wallet first.',
          });

          return;
        }

        // ----------------------------------------------------
        // Validate
        // ----------------------------------------------------

        const validationMessage =
          validateTradeInput();

        if (
          validationMessage
        ) {
          setMessage({
            type: 'error',
            text:
              validationMessage,
          });

          return;
        }

        // ----------------------------------------------------
        // Prevent duplicate clicks
        // ----------------------------------------------------

        if (placingTrade) {
          return;
        }

        setPlacingTrade(true);
        setMessage(null);

        try {
          // --------------------------------------------------
          // Client request ID
          //
          // Keeps request idempotent if user double clicks or
          // network retries occur.
          // --------------------------------------------------

          if (
            !clientRequestIdRef.current
          ) {
            clientRequestIdRef.current =
              PulseTradeService.createClientRequestId();
          }

          // --------------------------------------------------
          // Place backend-authoritative trade
          // --------------------------------------------------

          const result =
            await PulseTradeService.placeTrade(
              {
                symbol:
                  selectedPair,

                direction,

                duration:
                  selectedDuration,

                amount:
                  amountInput.trim(),

                clientRequestId:
                  clientRequestIdRef.current,
              },
            );

          // --------------------------------------------------
          // Store result
          // --------------------------------------------------

          setLastPlaced(
            result,
          );

          setMessage({
            type: 'success',
            text: `Trade accepted: ${result.trade.symbol} ${result.trade.direction} ${result.trade.duration}`,
          });

          // --------------------------------------------------
          // Clear request ID ONLY after successful request
          // --------------------------------------------------

          clientRequestIdRef.current =
            null;

          // ==================================================
          // IMPORTANT POST-TRADE REFRESH
          // ==================================================
          //
          // 1. Refresh wallet immediately because stake is
          //    locked/deducted.
          //
          // 2. Refresh Pulse state so open trade appears.
          //
          // ==================================================

          try {
            await refreshWallet();
          } catch {
            // Keep current wallet state.
          }

          await refreshOpenState();
        } catch (error) {
          const parsed =
            PulseTradeService.parseApiError(
              error,
            );

          const text =
            parsed.message ||
            'Failed to place trade';

          setMessage({
            type: 'error',
            text,
          });
        } finally {
          setPlacingTrade(false);
        }
      },
      [
        isAuthenticated,
        userId,
        selectedPair,
        selectedDirection,
        selectedDuration,
        amountInput,
        validateTradeInput,
        placingTrade,
        refreshOpenState,
        refreshWallet,
      ],
    );

  // ==========================================================
  // SETTLEMENT POPUP DETECTION
  // ==========================================================
  // History is refreshed every 3 seconds by polling. When a
  // trade that settled after session start shows a WIN/LOSS/
  // DRAW result, fire the shared WinLossPopup once.
  // ==========================================================

  useEffect(() => {
    if (!history || history.length === 0) {
      return;
    }

    for (const trade of history) {
      const result = String(
        trade.result ?? '',
      ).toUpperCase();

      if (
        result !== 'WIN' &&
        result !== 'WON' &&
        result !== 'LOSS' &&
        result !== 'LOST' &&
        result !== 'DRAW'
      ) {
        continue;
      }

      const settledAtMs = new Date(
        trade.settledAt ?? trade.expiresAt ?? 0,
      ).getTime();

      if (
        !Number.isFinite(settledAtMs) ||
        settledAtMs < sessionStartedAtRef.current
      ) {
        continue;
      }

      if (notifiedTradeIdsRef.current.has(trade.id)) {
        continue;
      }

      notifiedTradeIdsRef.current.add(trade.id);

      const isWin =
        result === 'WIN' || result === 'WON';

      const isDraw = result === 'DRAW';

      const stake = Number(trade.stake ?? 0);

      const payout = Number(trade.payout ?? 0);

      const formatTdx = (value: number) =>
        Number.isFinite(value)
          ? value.toLocaleString('en-IN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : '0.00';

      const creditedAmount = isWin
        ? payout > 0
          ? payout
          : stake
        : stake;

      setSettlementPopup({
        id: String(trade.id),
        outcome: isWin
          ? 'win'
          : isDraw
            ? 'draw'
            : 'loss',
        title: isWin
          ? 'Trade Won!'
          : isDraw
            ? "It's a Draw"
            : 'Trade Lost',
        detail: `${trade.symbol} • ${
          trade.direction === 'LONG'
            ? '▲ LONG'
            : '▼ SHORT'
        } • ${trade.duration}`,
        amount: isWin
          ? `+${formatTdx(creditedAmount)} TDX`
          : `${formatTdx(stake)} TDX`,
        meta: isWin
          ? 'Profit credited to your wallet'
          : isDraw
            ? 'Stake refunded to your wallet'
            : 'Better luck next trade!',
      });

      break;
    }
  }, [history]);

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    void loadInitialData();
  }, [
    loadInitialData,
  ]);

  // ==========================================================
  // REAL-TIME POLLING
  // ==========================================================
  //
  // Every 3 seconds:
  //
  //     refreshOpenState()
  //
  // Which refreshes:
  //
  //     Market price
  //     Open trades
  //     History
  //     Portfolio
  //     Wallet balance
  //
  // Therefore after settlement the balance updates without
  // manually refreshing the browser.
  //
  useEffect(() => {
    // --------------------------------------------------------
    // Clear previous timer
    // --------------------------------------------------------

    if (
      pollRef.current
    ) {
      window.clearInterval(
        pollRef.current,
      );

      pollRef.current = null;
    }

    // --------------------------------------------------------
    // Don't poll when logged out
    // --------------------------------------------------------

    if (
      !isAuthenticated ||
      !userId
    ) {
      return;
    }

    // --------------------------------------------------------
    // Start polling
    // --------------------------------------------------------

    pollRef.current =
      window.setInterval(
        () => {
          void refreshOpenState();
        },
        OPEN_REFRESH_MS,
      );

    // --------------------------------------------------------
    // Cleanup
    // --------------------------------------------------------

    return () => {
      if (
        pollRef.current
      ) {
        window.clearInterval(
          pollRef.current,
        );

        pollRef.current = null;
      }
    };
  }, [
    isAuthenticated,
    userId,
    refreshOpenState,
  ]);

  // ==========================================================
  // ACTIVE TRADE DETAIL
  // ==========================================================

  useEffect(() => {
    if (
      !activeTrade?.id
    ) {
      setActiveTradeDetail(
        null,
      );

      return;
    }

    void loadTradeDetail(
      activeTrade.id,
    );
  }, [
    activeTrade?.id,
    loadTradeDetail,
  ]);

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    // --------------------------------------------------------
    // FORM
    // --------------------------------------------------------

    selectedPair,

    setSelectedPair,

    selectedDuration,

    setSelectedDuration,

    selectedDirection,

    setSelectedDirection,

    amountInput,

    setAmountInput,

    // --------------------------------------------------------
    // MARKET
    // --------------------------------------------------------

    markets,

    currentPrice,

    // --------------------------------------------------------
    // TRADES
    // --------------------------------------------------------

    openTrades,

    history,

    activeTrade,

    activeTradeDetail,

    lastPlaced,

    // --------------------------------------------------------
    // SETTLEMENT POPUP
    // --------------------------------------------------------

    settlementPopup,

    dismissSettlementPopup: () => setSettlementPopup(null),

    // --------------------------------------------------------
    // PORTFOLIO / RISK
    // --------------------------------------------------------

    portfolio,

    risk,

    // --------------------------------------------------------
    // UI STATE
    // --------------------------------------------------------

    loading,

    placingTrade,

    message,

    setMessage,

    // --------------------------------------------------------
    // WALLET
    // --------------------------------------------------------

    walletAvailable:
      balance.tdxAvailable ||
      balance.tdx,

    // --------------------------------------------------------
    // ACTIONS
    // --------------------------------------------------------

    placeTrade,

    reload:
      loadInitialData,
  };
}