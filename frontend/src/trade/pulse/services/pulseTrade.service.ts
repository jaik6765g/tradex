// ============================================================
// PULSE TRADE SERVICE - FRONTEND API CLIENT
// ============================================================

import { AxiosError } from 'axios';

import { apiClient } from '../../../core/api/client';

import type {
  PlacePulseTradeRequest,
  PlacePulseTradeResponse,
  PulseDuration,
  PulseLiquidityResponse,
  PulseMarketsResponse,
  PulseOpenTradesResponse,
  PulsePair,
  PulsePortfolioResponse,
  PulsePriceResponse,
  PulseRiskResponse,
  PulseTradeDetailResponse,
  PulseTradeHistoryQuery,
  PulseTradeHistoryResponse,
} from '../types';

type PulseApiErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
};

export class PulseTradeService {
  static createClientRequestId(): string {
    return `pulse-${Date.now()}-${crypto.randomUUID()}`;
  }

  static parseApiError(error: unknown): Error {
    if (!(error instanceof AxiosError)) {
      return error instanceof Error
        ? error
        : new Error('Unexpected Pulse Trade error');
    }

    const status = error.response?.status;

    const data = (error.response?.data ?? {}) as PulseApiErrorPayload;

    const code = String(
      data.code ?? '',
    ).toUpperCase();

    const backendMessage =
      data.message?.trim();

    if (status === 401) {
      return new Error(
        'Authentication failed. Please reconnect wallet and login again.',
      );
    }

    const explicitMap: Record<string, string> = {
      INSUFFICIENT_BALANCE:
        'Insufficient TDX balance to place this trade.',

      AMOUNT_BELOW_MINIMUM:
        'Amount is below minimum 10 TDX.',

      AMOUNT_ABOVE_MAXIMUM:
        'Amount exceeds maximum 10,000 TDX.',

      INVALID_SYMBOL:
        'Invalid trading pair. Supported: BTC/USDT, ETH/USDT, BNB/USDT, SOL/USDT.',

      INVALID_DURATION:
        'Invalid duration. Supported: 30S, 1M, 3M, 5M, 10M.',

      INVALID_DIRECTION:
        'Invalid direction. Use LONG or SHORT.',

      RISK_LIMIT_REACHED:
        'Trade rejected by risk controls. Please reduce amount or try later.',

      LIQUIDITY_LIMIT_REACHED:
        'Trade rejected due to liquidity limits. Please try again later.',

      DUPLICATE_REQUEST:
        'Duplicate trade request detected. Previous result has been reused.',

      TRADING_CUTOFF_REACHED:
        'Trading is locked near expiry cutoff for this duration.',
    };

    if (explicitMap[code]) {
      return new Error(
        explicitMap[code],
      );
    }

    const rawMessage =
      backendMessage ??
      String(
        error.message ??
          'Pulse Trade request failed',
      );

    const upper =
      rawMessage.toUpperCase();

    if (
      upper.includes(
        'INSUFFICIENT_BALANCE',
      )
    ) {
      return new Error(
        explicitMap.INSUFFICIENT_BALANCE,
      );
    }

    if (
      upper.includes('INVALID_SYMBOL')
    ) {
      return new Error(
        explicitMap.INVALID_SYMBOL,
      );
    }

    if (
      upper.includes(
        'INVALID_DURATION',
      )
    ) {
      return new Error(
        explicitMap.INVALID_DURATION,
      );
    }

    if (
      upper.includes(
        'INVALID_DIRECTION',
      )
    ) {
      return new Error(
        explicitMap.INVALID_DIRECTION,
      );
    }

    if (
      upper.includes(
        'RISK_LIMIT_REACHED',
      )
    ) {
      return new Error(
        explicitMap.RISK_LIMIT_REACHED,
      );
    }

    if (
      upper.includes(
        'LIQUIDITY_LIMIT_REACHED',
      )
    ) {
      return new Error(
        explicitMap.LIQUIDITY_LIMIT_REACHED,
      );
    }

    if (
      upper.includes(
        'DUPLICATE_REQUEST',
      ) ||
      upper.includes('CLIENTREQUESTID')
    ) {
      return new Error(
        explicitMap.DUPLICATE_REQUEST,
      );
    }

    if (
      status === 400 ||
      status === 422
    ) {
      return new Error(
        backendMessage ||
          'Invalid trade request. Please verify your inputs.',
      );
    }

    if (status === 409) {
      return new Error(
        backendMessage ||
          'Trade could not be accepted due to current market constraints.',
      );
    }

    if (status === 429) {
      return new Error(
        'Too many requests. Please wait a moment and retry.',
      );
    }

    if (status === 500) {
      return new Error(
        'Pulse Trade service error. Please try again shortly.',
      );
    }

    return new Error(
      backendMessage ||
        'Pulse Trade request failed.',
    );
  }

  // ============================================================
  // MARKETS
  // ============================================================

  static async getMarkets(): Promise<PulseMarketsResponse> {
    const response =
      await apiClient.get<PulseMarketsResponse>(
        '/pulse-trade/markets',
      );

    return response.data;
  }

  static async getMarketPrice(
    symbol: PulsePair,
  ): Promise<PulsePriceResponse> {
    const encodedSymbol =
      encodeURIComponent(symbol);

    const response =
      await apiClient.get<PulsePriceResponse>(
        `/pulse-trade/markets/${encodedSymbol}/price`,
      );

    return response.data;
  }

  // ============================================================
  // PLACE TRADE
  // ============================================================

  static async placeTrade(input: {
    symbol: PulsePair;
    direction: 'LONG' | 'SHORT';
    duration: PulseDuration;
    amount: string;
    clientRequestId?: string;
  }): Promise<PlacePulseTradeResponse> {
    const payload: PlacePulseTradeRequest = {
      symbol: input.symbol,
      direction: input.direction,
      duration: input.duration,
      amount: input.amount,
      clientRequestId:
        input.clientRequestId ??
        this.createClientRequestId(),
    };

    try {
      const response =
        await apiClient.post<PlacePulseTradeResponse>(
          '/pulse-trade/trades',
          payload,
        );

      return response.data;
    } catch (error) {
      throw this.parseApiError(error);
    }
  }

  // ============================================================
  // OPEN TRADES
  // ============================================================

  static async getOpenTrades(): Promise<PulseOpenTradesResponse> {
    const response =
      await apiClient.get<PulseOpenTradesResponse>(
        '/pulse-trade/trades/open',
      );

    return response.data;
  }

  // ============================================================
  // TRADE HISTORY
  // ============================================================

  static async getTradeHistory(
    query: PulseTradeHistoryQuery = {},
  ): Promise<PulseTradeHistoryResponse> {
    const response =
      await apiClient.get<PulseTradeHistoryResponse>(
        '/pulse-trade/trades/history',
        {
          params: query,
        },
      );

    return response.data;
  }

  // ============================================================
  // TRADE DETAIL
  // ============================================================

  static async getTradeById(
    tradeId: string,
  ): Promise<PulseTradeDetailResponse> {
    const response =
      await apiClient.get<PulseTradeDetailResponse>(
        `/pulse-trade/trades/${encodeURIComponent(
          tradeId,
        )}`,
      );

    return response.data;
  }

  // ============================================================
  // PORTFOLIO
  // ============================================================

  static async getPortfolio(): Promise<PulsePortfolioResponse> {
    const response =
      await apiClient.get<PulsePortfolioResponse>(
        '/pulse-trade/portfolio',
      );

    return response.data;
  }

  // ============================================================
  // LIQUIDITY
  // ============================================================

  static async getLiquidity(): Promise<PulseLiquidityResponse> {
    const response =
      await apiClient.get<PulseLiquidityResponse>(
        '/pulse-trade/liquidity',
      );

    return response.data;
  }

  // ============================================================
  // RISK
  // ============================================================

  static async getRisk(): Promise<PulseRiskResponse> {
    const response =
      await apiClient.get<PulseRiskResponse>(
        '/pulse-trade/risk',
      );

    return response.data;
  }
}