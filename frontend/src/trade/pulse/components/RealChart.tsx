// ============================================================
// REAL-TIME PULSE TRADE CHART (LIGHT THEME)
// Glass Active Trade Card + Drag + Entry/Expiry Lines
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useRealTimeChartData, type CandleData } from '../hooks/useRealTimeChartData';

// ============================================================
// TYPES
// ============================================================

export type ChartTrade = {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  amount?: string | number;
  stake?: string | number;
  entryPrice?: string | number;
  expiryPrice?: string | number;
  exitPrice?: string | number;
  settlementPrice?: string | number;
  entryAt?: string | number | null;
  expiresAt?: string | number | null;
  settledAt?: string | number | null;
  createdAt?: string | number | null;
  result?: string;
  status?: string;
  payout?: string | number;
};

interface RealChartProps {
  selectedPair: string;
  markets: string[];
  onPairChange: (pair: string) => void;
  pairDisabled?: boolean;
  interval?: string;
  height?: number;
  activeTrade?: ChartTrade | null;
  openTrades?: ChartTrade[];
  history?: ChartTrade[];
}

// ============================================================
// CONSTANTS
// ============================================================

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;

// ============================================================
// HELPERS
// ============================================================

const toChartSymbol = (symbol: string): string => symbol.replace('/', '').toUpperCase();

const formatUsd = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
};

const getTimestampMs = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getUnixSeconds = (value: string | number | null | undefined): number | null => {
  const ms = getTimestampMs(value);
  return ms === null ? null : Math.floor(ms / 1000);
};

const formatCountdown = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

// ============================================================
// COMPONENT
// ============================================================

export const RealChart: React.FC<RealChartProps> = ({
                                                      selectedPair,
                                                      markets,
                                                      onPairChange,
                                                      pairDisabled = false,
                                                      interval = '1m',
                                                      height,
                                                      activeTrade = null,
                                                    }) => {
  // ==========================================================
  // REFS
  // ==========================================================

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const hasFitContentRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  // ==========================================================
  // STATE
  // ==========================================================

  const [activeInterval, setActiveInterval] = useState(interval);
  const [remainingMs, setRemainingMs] = useState(0);
  const [entryChartX, setEntryChartX] = useState<number | null>(null);
  const [expiryChartX, setExpiryChartX] = useState<number | null>(null);
  const [cardPosition, setCardPosition] = useState({ left: 70, top: 5 });
  const [isDragging, setIsDragging] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  // ==========================================================
  // SYMBOL
  // ==========================================================

  const normalizedSymbol = useMemo(() => toChartSymbol(selectedPair), [selectedPair]);
  const pairOptions = markets.length > 0 ? markets : [selectedPair];

  // ==========================================================
  // MARKET DATA
  // ==========================================================

  const { candles, currentPrice, isConnected, volume, high24h, low24h, change24h } =
      useRealTimeChartData(normalizedSymbol.toLowerCase(), activeInterval);

  // ==========================================================
  // ACTIVE TRADE
  // ==========================================================

  const hasActiveTrade = Boolean(activeTrade?.id);
  const entryPrice = Number(activeTrade?.entryPrice ?? 0);
  const lastCandleClose = candles[candles.length - 1]?.close ?? 0;
  const displayPrice = currentPrice ?? lastCandleClose;
  const livePrice = Number(displayPrice);
  const timerFinished = hasActiveTrade && remainingMs <= 0;

  // ==========================================================
  // INDICATIVE P/L
  // ==========================================================

  let liveMovePercent = 0;
  if (entryPrice > 0 && livePrice > 0) {
    const rawMove = ((livePrice - entryPrice) / entryPrice) * 100;
    liveMovePercent = activeTrade?.direction === 'SHORT' ? -rawMove : rawMove;
  }
  const liveMovePositive = liveMovePercent >= 0;

  // ==========================================================
  // INTERVAL SYNC
  // ==========================================================

  useEffect(() => setActiveInterval(interval), [interval]);

  // ==========================================================
  // RESET CARD POSITION
  // ==========================================================

  useEffect(() => {
    if (hasActiveTrade) setCardPosition({ left: 70, top: 5 });
  }, [activeTrade?.id]);

  // ==========================================================
  // COUNTDOWN
  // ==========================================================

  useEffect(() => {
    if (!hasActiveTrade) {
      setRemainingMs(0);
      return;
    }
    const expiryMs = getTimestampMs(activeTrade?.expiresAt);
    if (expiryMs === null) {
      setRemainingMs(0);
      return;
    }
    const updateTimer = () => setRemainingMs(Math.max(0, expiryMs - Date.now()));
    updateTimer();
    const timer = window.setInterval(updateTimer, 250);
    return () => window.clearInterval(timer);
  }, [hasActiveTrade, activeTrade?.expiresAt]);

  // ==========================================================
  // CREATE CHART
  // ==========================================================

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const initialHeight = height ?? Math.floor(container.clientHeight);

    const chart = createChart(container, {
      width: container.clientWidth,
      height: initialHeight > 0 ? initialHeight : 300,
      layout: {
        background: { type: ColorType.Solid, color: '#FFFFFF' },
        textColor: '#101828',
      },
      grid: {
        vertLines: { color: '#F2F4F7' },
        horzLines: { color: '#F2F4F7' },
      },
      rightPriceScale: {
        borderColor: '#EAECF0',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#EAECF0',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderUpColor: '#16A34A',
      borderDownColor: '#DC2626',
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineWidth: 1,
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    hasFitContentRef.current = false;
    setChartReady(true);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const nextHeight = height ?? Math.floor(entry.contentRect.height);
      if (width > 0 && nextHeight > 0) {
        chart.applyOptions({ width, height: nextHeight });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
      setChartReady(false);
    };
  }, [height]);

  // ==========================================================
  // CANDLE DATA
  // ==========================================================

  useEffect(() => {
    if (!seriesRef.current) return;

    const cleaned = candles.filter(
        (candle) =>
            Number.isFinite(Number(candle.time)) &&
            Number.isFinite(candle.open) &&
            Number.isFinite(candle.high) &&
            Number.isFinite(candle.low) &&
            Number.isFinite(candle.close)
    );

    const byTime = new Map<number, CandleData>();
    for (const candle of cleaned) {
      byTime.set(Number(candle.time), candle);
    }

    const sorted = Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
    seriesRef.current.setData(sorted);

    if (sorted.length > 0 && !hasFitContentRef.current) {
      chartRef.current?.timeScale().fitContent();
      hasFitContentRef.current = true;
    }
  }, [candles]);

  // ==========================================================
  // RESET FIT
  // ==========================================================

  useEffect(() => {
    hasFitContentRef.current = false;
  }, [normalizedSymbol, activeInterval]);

  // ==========================================================
  // ENTRY / EXPIRY VERTICAL LINES
  // ==========================================================

  useEffect(() => {
    if (!chartRef.current || !hasActiveTrade || !chartReady) {
      setEntryChartX(null);
      setExpiryChartX(null);
      return;
    }

    const entrySeconds = getUnixSeconds(activeTrade?.entryAt);
    const expirySeconds = getUnixSeconds(activeTrade?.expiresAt);

    let lastEntryX: number | null = null;
    let lastExpiryX: number | null = null;

    const updatePositions = () => {
      const chart = chartRef.current;
      if (!chart) return;

      const timeScale = chart.timeScale();
      const visibleRange = timeScale.getVisibleRange();
      if (!visibleRange) {
        timeScale.fitContent();
        const newRange = timeScale.getVisibleRange();
        if (!newRange) return;
      }

      let entryX: number | null = null;
      let expiryX: number | null = null;

      if (entrySeconds !== null) {
        const coord = timeScale.timeToCoordinate(entrySeconds as Time);
        entryX = typeof coord === 'number' ? coord : null;
      }

      if (expirySeconds !== null) {
        const coord = timeScale.timeToCoordinate(expirySeconds as Time);
        expiryX = typeof coord === 'number' ? coord : null;
      }

      if (entryX !== lastEntryX) {
        lastEntryX = entryX;
        setEntryChartX(entryX);
      }

      if (expiryX !== lastExpiryX) {
        lastExpiryX = expiryX;
        setExpiryChartX(expiryX);
      }
    };

    const attemptUpdate = (attempt = 0) => {
      updatePositions();
      if ((entryChartX === null || expiryChartX === null) && attempt < 10) {
        setTimeout(() => attemptUpdate(attempt + 1), 200);
      }
    };

    const initialTimeout = setTimeout(() => {
      attemptUpdate(0);
    }, 150);

    const chart = chartRef.current;
    const timeScale = chart?.timeScale();

    const handleVisibleRangeChange = () => {
      updatePositions();
    };

    if (timeScale && typeof timeScale.subscribeVisibleTimeRangeChange === 'function') {
      timeScale.subscribeVisibleTimeRangeChange(handleVisibleRangeChange);
    }

    const handleResize = () => {
      updatePositions();
    };
    window.addEventListener('resize', handleResize);

    const timer = window.setInterval(updatePositions, 300);

    return () => {
      clearTimeout(initialTimeout);
      window.clearInterval(timer);
      window.removeEventListener('resize', handleResize);
      if (timeScale && typeof timeScale.unsubscribeVisibleTimeRangeChange === 'function') {
        timeScale.unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
      }
    };
  }, [hasActiveTrade, activeTrade?.entryAt, activeTrade?.expiresAt, candles.length, chartReady]);

  // ==========================================================
  // FORCE UPDATE ON CANDLE CHANGE
  // ==========================================================

  useEffect(() => {
    if (chartReady && hasActiveTrade) {
      const timeScale = chartRef.current?.timeScale();
      if (timeScale) {
        const entrySeconds = getUnixSeconds(activeTrade?.entryAt);
        const expirySeconds = getUnixSeconds(activeTrade?.expiresAt);

        if (entrySeconds !== null) {
          const coord = timeScale.timeToCoordinate(entrySeconds as Time);
          if (typeof coord === 'number') setEntryChartX(coord);
        }
        if (expirySeconds !== null) {
          const coord = timeScale.timeToCoordinate(expirySeconds as Time);
          if (typeof coord === 'number') setExpiryChartX(coord);
        }
      }
    }
  }, [candles.length, chartReady, hasActiveTrade, activeTrade?.entryAt, activeTrade?.expiresAt]);

  // ==========================================================
  // DRAG CARD
  // ==========================================================

  const handleCardPointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const startLeftPx = (cardPosition.left / 100) * rect.width;
        const startTopPx = (cardPosition.top / 100) * rect.height;

        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startLeft: startLeftPx,
          startTop: startTopPx,
        };
        setIsDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      },
      [cardPosition.left, cardPosition.top]
  );

  const handleCardPointerMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || !containerRef.current) return;
        if (event.pointerId !== drag.pointerId) return;

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;

        const cardWidth = Math.min(200, Math.max(160, rect.width * 0.35));
        const cardHeight = 180;

        const minLeft = 4;
        const maxLeft = Math.max(minLeft, rect.width - cardWidth - 4);
        const minTop = 4;
        const maxTop = Math.max(minTop, rect.height - cardHeight - 4);

        const nextLeftPx = Math.min(maxLeft, Math.max(minLeft, drag.startLeft + deltaX));
        const nextTopPx = Math.min(maxTop, Math.max(minTop, drag.startTop + deltaY));

        setCardPosition({
          left: rect.width > 0 ? (nextLeftPx / rect.width) * 100 : 70,
          top: rect.height > 0 ? (nextTopPx / rect.height) * 100 : 5,
        });
        event.preventDefault();
      },
      []
  );

  const handleCardPointerUp = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        setIsDragging(false);
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may already be released.
        }
        event.preventDefault();
      },
      []
  );

  // ==========================================================
  // PRICE COLOR
  // ==========================================================

  const priceColorClass = change24h >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]';

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
      <div className="overflow-hidden rounded-2xl border border-[#E9ECF2] bg-white shadow-[0_4px_20px_rgba(16,24,40,0.04)]">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAECF0] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <select
                value={selectedPair}
                onChange={(event) => onPairChange(event.target.value)}
                disabled={pairDisabled}
                className="h-9 rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm font-semibold text-[#101828] outline-none focus:border-[#F5B800] focus:ring-2 focus:ring-[#F5B800]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pairOptions.map((pair) => (
                  <option key={pair} value={pair}>
                    {pair}
                  </option>
              ))}
            </select>
            <span className={`text-base font-bold ${priceColorClass}`}>
            {formatUsd(displayPrice || 0)}
          </span>
            <span className={`text-xs font-semibold ${priceColorClass}`}>
            {change24h >= 0 ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
          </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#667085]">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[#16A34A]' : 'bg-[#DC2626]'}`} />
            {isConnected ? 'Live' : 'Reconnecting...'}
          </div>
        </div>

        {/* STATS */}
        <div className="flex flex-wrap gap-3 border-b border-[#EAECF0] bg-[#F9FAFB] px-3 py-2 text-[11px] sm:gap-4 sm:px-4 sm:text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#667085]">24h High</span>
            <span className="font-mono text-[#101828]">{formatUsd(high24h || 0)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#667085]">24h Low</span>
            <span className="font-mono text-[#101828]">{formatUsd(low24h || 0)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#667085]">Vol</span>
            <span className="font-mono text-[#101828]">{volume.toFixed(2)}</span>
          </div>
        </div>

        {/* CHART AREA */}
        <div className="relative">
          {/* CHART */}
          <div
              ref={containerRef}
              className="relative h-[260px] w-full sm:h-[300px] md:h-[360px] lg:h-[430px]"
              style={height ? { height: `${height}px` } : undefined}
          />

          {/* ENTRY VERTICAL LINE */}
          {hasActiveTrade && entryChartX !== null && entryChartX > 0 && (
              <div
                  className="pointer-events-none absolute bottom-0 top-0 z-10"
                  style={{ left: `${entryChartX}px` }}
              >
                <div
                    className={`h-full w-[2px] ${
                        activeTrade?.direction === 'LONG' ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                    } opacity-70`}
                />
                <div
                    className={`absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[9px] font-bold shadow-lg ${
                        activeTrade?.direction === 'LONG' ? 'bg-[#16A34A] text-white' : 'bg-[#DC2626] text-white'
                    }`}
                >
                  {activeTrade?.direction === 'LONG' ? '▲ LONG ENTRY' : '▼ SHORT ENTRY'}
                </div>
                <div className="absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#EAECF0] bg-white/90 px-2 py-1 font-mono text-[9px] text-[#101828] backdrop-blur-md">
                  {formatUsd(entryPrice)}
                </div>
              </div>
          )}

          {/* EXPIRY VERTICAL LINE */}
          {hasActiveTrade && expiryChartX !== null && expiryChartX > 0 && (
              <div
                  className="pointer-events-none absolute bottom-0 top-0 z-10"
                  style={{ left: `${expiryChartX}px` }}
              >
                <div className="h-full w-[2px] bg-[#D97706] opacity-80" />
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#D97706] px-2 py-1 text-[9px] font-bold text-white shadow-lg">
                  EXPIRY
                </div>
                <div className="absolute bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#D97706]/40 bg-white/90 px-2 py-1 font-mono text-[11px] font-bold text-[#D97706] backdrop-blur-md">
                  {timerFinished ? 'SETTLING...' : formatCountdown(remainingMs)}
                </div>
              </div>
          )}

          {/* GLASS ACTIVE TRADE CARD (LIGHT) */}
          {hasActiveTrade && (
              <div
                  className="absolute z-30 w-[180px] max-w-[calc(100%-8px)] sm:w-[200px]"
                  style={{
                    left: `${cardPosition.left}%`,
                    top: `${cardPosition.top}%`,
                    touchAction: 'none',
                  }}
              >
                <div
                    onPointerDown={handleCardPointerDown}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    onPointerCancel={handleCardPointerUp}
                    className={`relative overflow-hidden rounded-xl border border-white/60 bg-white/80 shadow-[0_8px_32px_rgba(16,24,40,0.12)] backdrop-blur-xl backdrop-saturate-150 ${
                        isDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                >
                  {/* Glass Highlight */}
                  <div className="pointer-events-none absolute inset-0 bg-white/[0.03]" />
                  <div className="pointer-events-none absolute -left-8 -top-8 h-20 w-20 rounded-full bg-white/[0.06] blur-2xl" />

                  {/* Drag Handle */}
                  <div className="relative flex justify-center pt-1.5">
                    <div className="grid grid-cols-3 gap-[2px] rounded-full bg-[#F2F4F7] px-1.5 py-0.5">
                      {Array.from({ length: 6 }).map((_, index) => (
                          <span key={index} className="h-0.5 w-0.5 rounded-full bg-[#667085]/30" />
                      ))}
                    </div>
                  </div>

                  {/* Header */}
                  <div className="relative flex items-center justify-between border-b border-[#EAECF0] px-3 py-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                  <span
                      className={`text-sm font-bold ${
                          activeTrade?.direction === 'LONG' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                      }`}
                  >
                    {activeTrade?.direction === 'LONG' ? '▲' : '▼'}
                  </span>
                      <span
                          className={`text-sm font-bold ${
                              activeTrade?.direction === 'LONG' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }`}
                      >
                    {activeTrade?.direction}
                  </span>
                      <span className="truncate text-[10px] text-[#667085]">{activeTrade?.symbol}</span>
                    </div>
                    <span
                        className={`shrink-0 font-mono text-sm font-bold ${
                            timerFinished ? 'text-[#D97706]' : 'text-[#101828]'
                        }`}
                    >
                  {timerFinished ? '00:00' : formatCountdown(remainingMs)}
                </span>
                  </div>

                  {/* Entry / Current */}
                  <div className="relative grid grid-cols-2">
                    <div className="border-r border-[#EAECF0] px-3 py-1.5">
                      <p className="text-[8px] uppercase tracking-wide text-[#667085]">Entry</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-[#101828]">
                        {formatUsd(entryPrice)}
                      </p>
                    </div>
                    <div className="px-3 py-1.5">
                      <p className="text-[8px] uppercase tracking-wide text-[#667085]">Current</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-[#101828]">
                        {formatUsd(livePrice)}
                      </p>
                    </div>
                  </div>

                  {/* Indicative Move */}
                  <div className="relative flex items-center justify-between border-t border-[#EAECF0] px-3 py-1.5">
                    <span className="text-[8px] text-[#667085]">Move</span>
                    <span
                        className={`font-mono text-xs font-bold ${
                            liveMovePositive ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                    >
                  {liveMovePositive ? '▲' : '▼'} {Math.abs(liveMovePercent).toFixed(4)}%
                </span>
                  </div>

                  {/* Status */}
                  <div className="relative flex items-center justify-between border-t border-[#EAECF0] px-3 py-1.5">
                    <span className="text-[8px] text-[#667085]">Status</span>
                    <span
                        className={`text-[10px] font-bold ${
                            timerFinished ? 'text-[#D97706]' : 'text-[#16A34A]'
                        }`}
                    >
                  {timerFinished ? 'SETTLING' : 'ACTIVE'}
                </span>
                  </div>

                  {/* Drag Footer */}
                  <div className="relative flex items-center justify-center border-t border-[#EAECF0] px-3 py-1">
                    <span className="text-[8px] text-[#98A2B3]">⋯ Drag</span>
                  </div>
                </div>
              </div>
          )}
        </div>

        {/* TIMEFRAMES */}
        <div className="overflow-x-auto border-t border-[#EAECF0] bg-[#F9FAFB] px-2.5 py-1.5 sm:px-4 sm:py-2">
          <div className="flex w-max min-w-full gap-1">
            {TIMEFRAMES.map((tf) => (
                <button
                    key={tf}
                    type="button"
                    onClick={() => setActiveInterval(tf)}
                    className={`whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs ${
                        activeInterval === tf
                            ? 'bg-[#F5B800] text-[#101828] shadow-[0_2px_8px_rgba(245,184,0,0.3)]'
                            : 'text-[#667085] hover:bg-[#EAECF0] hover:text-[#101828]'
                    }`}
                >
                  {tf}
                </button>
            ))}
          </div>
        </div>
      </div>
  );
};