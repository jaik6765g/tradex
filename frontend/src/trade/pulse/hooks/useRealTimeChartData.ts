// src/trade/pulse/hooks/useRealTimeChartData.ts

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import {
  binanceWebSocket,
  type BinanceKlineData,
  type BinanceTradeData,
} from '../services/binanceWebSocket.service';

export type CandleData = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

interface UseRealTimeChartDataReturn {
  candles: CandleData[];
  currentPrice: number | null;
  isConnected: boolean;
  volume: number;
  high24h: number;
  low24h: number;
  change24h: number;
}

const HISTORICAL_LIMIT = 500;

function normalizeInterval(interval: string): string {
  const map: Record<string, string> = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
  };

  return map[interval] ?? '1m';
}

function buildKlineEndpoint(symbol: string, interval: string, limit: number): string {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(limit),
  });

  return `https://api.binance.com/api/v3/klines?${params.toString()}`;
}

function parseKlineRow(row: unknown): CandleData | null {
  if (!Array.isArray(row) || row.length < 6) return null;

  const openTimeMs = Number(row[0]);
  const open = Number.parseFloat(String(row[1]));
  const high = Number.parseFloat(String(row[2]));
  const low = Number.parseFloat(String(row[3]));
  const close = Number.parseFloat(String(row[4]));

  if (
    !Number.isFinite(openTimeMs) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return {
    time: Math.floor(openTimeMs / 1000) as UTCTimestamp,
    open,
    high,
    low,
    close,
  };
}

function dedupeAndSortCandles(candles: CandleData[]): CandleData[] {
  const byTime = new Map<number, CandleData>();

  for (const candle of candles) {
    byTime.set(Number(candle.time), candle);
  }

  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function applyLiveKline(prev: CandleData[], kline: BinanceKlineData): CandleData[] {
  const nextCandle: CandleData = {
    time: Math.floor(kline.openTime / 1000) as UTCTimestamp,
    open: kline.open,
    high: kline.high,
    low: kline.low,
    close: kline.close,
  };

  const updated = [...prev];
  const last = updated[updated.length - 1];

  if (!last) {
    return [nextCandle];
  }

  if (Number(last.time) === Number(nextCandle.time)) {
    updated[updated.length - 1] = nextCandle;
    return updated;
  }

  if (Number(nextCandle.time) > Number(last.time)) {
    updated.push(nextCandle);
  }

  return dedupeAndSortCandles(updated).slice(-HISTORICAL_LIMIT);
}

function buildStats(candles: CandleData[]) {
  if (candles.length === 0) {
    return {
      volume: 0,
      high24h: 0,
      low24h: 0,
      change24h: 0,
      currentPrice: null,
    };
  }

  const closes = candles.map((c) => c.close);
  const first = closes[0];
  const last = closes[closes.length - 1];

  return {
    volume: 0,
    high24h: Math.max(...candles.map((c) => c.high)),
    low24h: Math.min(...candles.map((c) => c.low)),
    change24h: first > 0 ? ((last - first) / first) * 100 : 0,
    currentPrice: last,
  };
}

export function useRealTimeChartData(symbol = 'btcusdt', interval = '1m'): UseRealTimeChartDataReturn {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(binanceWebSocket.getConnectionStatus());
  const [volume, setVolume] = useState(0);
  const [high24h, setHigh24h] = useState(0);
  const [low24h, setLow24h] = useState(0);
  const [change24h, setChange24h] = useState(0);
  const [liveTradePrice, setLiveTradePrice] = useState<number | null>(null);

  const normalizedSymbol = useMemo(() => symbol.toLowerCase(), [symbol]);
  const normalizedInterval = useMemo(() => normalizeInterval(interval), [interval]);

  const updateStats = useCallback((nextCandles: CandleData[]) => {
    const stats = buildStats(nextCandles);
    setVolume(stats.volume);
    setHigh24h(stats.high24h);
    setLow24h(stats.low24h);
    setChange24h(stats.change24h);
  }, []);

  useEffect(() => {
    let disposed = false;

    async function loadHistoricalData() {
      try {
        const endpoint = buildKlineEndpoint(normalizedSymbol, normalizedInterval, HISTORICAL_LIMIT);
        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error(`Failed to fetch klines (${response.status})`);
        }

        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) {
          throw new Error('Invalid kline response payload');
        }

        const parsed = payload.map(parseKlineRow).filter((candle): candle is CandleData => candle !== null);
        const normalized = dedupeAndSortCandles(parsed);

        if (disposed) return;

        setCandles(normalized);
        setLiveTradePrice(null);
        updateStats(normalized);
      } catch (error) {
        if (disposed) return;
        console.error('Failed to load historical Binance candles:', error);
      }
    }

    void loadHistoricalData();

    return () => {
      disposed = true;
    };
  }, [normalizedSymbol, normalizedInterval, updateStats]);

  useEffect(() => {
    const unsubscribeStatus = binanceWebSocket.subscribeConnectionStatus((connected) => {
      setIsConnected(connected);
    });

    return () => {
      unsubscribeStatus();
    };
  }, []);

  useEffect(() => {
    const klineStream = `${normalizedSymbol}@kline_${normalizedInterval}`;
    const tradeStream = `${normalizedSymbol}@trade`;

    const unsubscribeKline = binanceWebSocket.subscribe(klineStream, (payload) => {
      const kline = payload as BinanceKlineData;
      if (
        !Number.isFinite(kline.openTime) ||
        !Number.isFinite(kline.open) ||
        !Number.isFinite(kline.high) ||
        !Number.isFinite(kline.low) ||
        !Number.isFinite(kline.close)
      ) {
        return;
      }

      setCandles((prev) => {
        const next = applyLiveKline(prev, kline);
        updateStats(next);
        return next;
      });

      setLiveTradePrice(kline.close);
      setVolume((prevVolume) => prevVolume + (Number.isFinite(kline.volume) ? kline.volume : 0));
    });

    const unsubscribeTrade = binanceWebSocket.subscribe(tradeStream, (payload) => {
      const trade = payload as BinanceTradeData;
      if (!Number.isFinite(trade.price)) return;
      setLiveTradePrice(trade.price);
    });

    return () => {
      unsubscribeKline();
      unsubscribeTrade();
    };
  }, [normalizedSymbol, normalizedInterval, updateStats]);

  const currentPrice = liveTradePrice ?? candles[candles.length - 1]?.close ?? null;

  return {
    candles,
    currentPrice,
    isConnected,
    volume,
    high24h,
    low24h,
    change24h,
  };
}