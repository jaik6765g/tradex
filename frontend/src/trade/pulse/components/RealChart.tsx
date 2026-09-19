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

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Active-trade card box. Width mirrors the original design
 * (w-[180px] on phones / sm:w-[200px] from the sm breakpoint) and the
 * height is the reserved drag box, so the card can be clamped to stay
 * FULLY inside the chart area — it must never be clipped on the right
 * or bottom edge.
 */
const TRADE_CARD_HEIGHT_PX = 180;
const TRADE_CARD_MARGIN_PX = 6;

const resolveTradeCardWidth = (containerWidth: number): number =>
  containerWidth >= 640 ? 200 : 180;

const getTradeCardBounds = (containerWidth: number, containerHeight: number) => {
  const width = resolveTradeCardWidth(containerWidth);
  return {
    width,
    maxLeft: Math.max(0, containerWidth - width - TRADE_CARD_MARGIN_PX),
    maxTop: Math.max(0, containerHeight - TRADE_CARD_HEIGHT_PX - TRADE_CARD_MARGIN_PX),
  };
};

/** Approximate rendered half-width of the single-row position label. */
const ENTRY_LABEL_HALF_PX = 96;

/** Width of the filled price tag drawn over the right price scale. */
const ENTRY_AXIS_TAG_WIDTH_PX = 62;

/** Gap kept between the position label and the chart edges / price tag. */
const ENTRY_LABEL_EDGE_GAP_PX = 2;

/** Rendered height of the position-line label row (used for edge clamping). */
const ENTRY_LABEL_HEIGHT_PX = 26;

/** Same idea for the EXPIRY / countdown labels on the expiry line. */
const EXPIRY_LABEL_SAFE_HALF_PX = 52;

/**
 * Stake shown in the position-line label (e.g. `100`). Kept as a plain
 * number string so it reads like the exchange qty block in the design.
 */
const formatStakeAmount = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

/**
 * Maps a price LEVEL to a vertical pixel coordinate on the chart, so the
 * entry price can be drawn as a horizontal line (TradingView position
 * tool style). Returns null when there is no series or the price is
 * outside the current price scale — callers must then hide the line
 * instead of rendering a stale/incorrect one.
 */
const priceToChartY = (
  series: ISeriesApi<'Candlestick', Time> | null,
  price: number,
): number | null => {
  if (!series || !Number.isFinite(price) || price <= 0) return null;
  const coord = series.priceToCoordinate(price);
  if (typeof coord !== 'number' || !Number.isFinite(coord)) return null;
  // Whole pixels only — sub-pixel deltas would re-render the overlay on
  // every tick (visible jitter) without any visual benefit.
  return Math.round(coord);
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
  const [entryChartY, setEntryChartY] = useState<number | null>(null);
  const [expiryChartX, setExpiryChartX] = useState<number | null>(null);
  const [cardPosition, setCardPosition] = useState({ left: 70, top: 5 });
  const [isDragging, setIsDragging] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [chartAreaSize, setChartAreaSize] = useState({ width: 0, height: 0 });

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

  /** Stake shown as the qty block on the position line (stake → amount). */
  const tradeStake = Number(activeTrade?.stake ?? activeTrade?.amount ?? 0);

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
  // CHART AREA SIZE (for clamping the overlays inside the chart)
  // ==========================================================

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateSize = () => {
      setChartAreaSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [height]);

  // Clamped card box — keeps the draggable card fully inside the chart
  // area on EVERY viewport (previously left:70% + 180px overflowed to
  // the right on phones and got clipped by the rounded card).
  const tradeCardBounds = useMemo(
      () => getTradeCardBounds(chartAreaSize.width, chartAreaSize.height),
      [chartAreaSize.width, chartAreaSize.height]
  );

  const tradeCardLeftPx = useMemo(
      () => clampNumber((cardPosition.left / 100) * chartAreaSize.width, 0, tradeCardBounds.maxLeft),
      [cardPosition.left, chartAreaSize.width, tradeCardBounds.maxLeft]
  );

  const tradeCardTopPx = useMemo(
      () => clampNumber((cardPosition.top / 100) * chartAreaSize.height, 0, tradeCardBounds.maxTop),
      [cardPosition.top, chartAreaSize.height, tradeCardBounds.maxTop]
  );

  // ==========================================================
  // POSITION-LINE LABEL (single row on the entry price line)
  // ==========================================================

  /** True → LONG (green), false → SHORT (red). Mirrors the card styling. */
  const isLongDirection = activeTrade?.direction !== 'SHORT';

  /**
   * The entry PRICE level must be inside the visible chart area — if the
   * market has moved far away from it the line is off-screen and showing
   * a clamped label would misrepresent the level, so we hide it instead.
   */
  const entryLevelVisible =
      entryChartY !== null &&
      chartAreaSize.height > 0 &&
      entryChartY >= 0 &&
      entryChartY <= chartAreaSize.height;

  /**
   * Top offset that keeps the single-row label fully inside the chart
   * area even when the entry price line sits on the very top/bottom edge
   * (otherwise the row would be half-cut by the container).
   */
  const entryLabelTopPx = useMemo(() => {
    if (entryChartY === null) return null;
    const maxTop = Math.max(
        ENTRY_LABEL_EDGE_GAP_PX,
        chartAreaSize.height - ENTRY_LABEL_HEIGHT_PX - ENTRY_LABEL_EDGE_GAP_PX
    );
    return clampNumber(
        Math.round(entryChartY - ENTRY_LABEL_HEIGHT_PX / 2),
        ENTRY_LABEL_EDGE_GAP_PX,
        maxTop
    );
  }, [entryChartY, chartAreaSize.height]);

  /**
   * Left offset (px, centre-anchored) for the position label. It follows
   * the entry-time marker but is clamped so the whole single row stays
   * inside the chart AND clear of the price tag on every viewport — a
   * pure CSS `clamp()` cannot do the tag part on very narrow charts.
   */
  const entryLabelLeftPx = useMemo(() => {
    const width = chartAreaSize.width;
    const minLeft = ENTRY_LABEL_HALF_PX + ENTRY_LABEL_EDGE_GAP_PX;
    if (width <= 0) return minLeft;
    const maxLeft = Math.max(
        minLeft,
        width - ENTRY_LABEL_HALF_PX - ENTRY_AXIS_TAG_WIDTH_PX - ENTRY_LABEL_EDGE_GAP_PX
    );
    const anchor = entryChartX === null ? minLeft : entryChartX;
    return clampNumber(anchor, minLeft, maxLeft);
  }, [entryChartX, chartAreaSize.width]);

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
        background: { type: ColorType.Solid, color: '#15161C' },
        textColor: '#F5F5F7',
      },
      grid: {
        vertLines: { color: '#1B1917' },
        horzLines: { color: '#1B1917' },
      },
      rightPriceScale: {
        borderColor: '#202229',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: '#202229',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#4ADE80',
      downColor: '#DC2626',
      borderUpColor: '#4ADE80',
      borderDownColor: '#DC2626',
      wickUpColor: '#4ADE80',
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
      setEntryChartY(null);
      setExpiryChartX(null);
      return;
    }

    const entrySeconds = getUnixSeconds(activeTrade?.entryAt);
    const expirySeconds = getUnixSeconds(activeTrade?.expiresAt);

    let lastEntryX: number | null = null;
    let lastEntryY: number | null = null;
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

      // Horizontal entry PRICE line (position tool). Recomputed together
      // with the time coordinate because panning/zooming changes the
      // vertical price scale as well as the time scale.
      const entryY = priceToChartY(seriesRef.current, entryPrice);

      if (entryY !== lastEntryY) {
        lastEntryY = entryY;
        setEntryChartY(entryY);
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
  }, [hasActiveTrade, activeTrade?.entryAt, activeTrade?.expiresAt, entryPrice, candles.length, chartReady]);

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

        // Live candles move the autoscaled price scale, so the entry
        // PRICE line must be re-projected on every candle tick too —
        // otherwise the horizontal line drifts off the real level.
        setEntryChartY(priceToChartY(seriesRef.current, entryPrice));
      }
    }
  }, [candles.length, chartReady, hasActiveTrade, activeTrade?.entryAt, activeTrade?.expiresAt, entryPrice]);

  // ==========================================================
  // DRAG CARD
  // ==========================================================

  const handleCardPointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const bounds = getTradeCardBounds(rect.width, rect.height);
        // Start from the CLAMPED (rendered) px so dragging never jumps
        // when the card was auto-clamped away from its % position.
        const startLeftPx = clampNumber((cardPosition.left / 100) * rect.width, 0, bounds.maxLeft);
        const startTopPx = clampNumber((cardPosition.top / 100) * rect.height, 0, bounds.maxTop);

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

        const bounds = getTradeCardBounds(rect.width, rect.height);

        const nextLeftPx = clampNumber(drag.startLeft + deltaX, 0, bounds.maxLeft);
        const nextTopPx = clampNumber(drag.startTop + deltaY, 0, bounds.maxTop);

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

  const priceColorClass = change24h >= 0 ? 'text-[#4ADE80]' : 'text-[#DC2626]';

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
      /* Full-bleed on phones: the negative margin cancels the page's
         `px-2` gutter so the chart card spans the entire screen width
         (left↔right fit), while staying inside the normal rounded card
         layout from the `sm` breakpoint upwards. */
      <div className="-mx-2 overflow-hidden rounded-none border-y border-[#202229] bg-[#15161C] shadow-[0_4px_20px_rgba(16,24,40,0.04)] sm:mx-0 sm:rounded-2xl sm:border">
        {/* HEADER */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202229] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <select
                value={selectedPair}
                onChange={(event) => onPairChange(event.target.value)}
                disabled={pairDisabled}
                className="h-9 rounded-lg border border-[#34343E] bg-[#15161C] px-3 text-sm font-semibold text-[#F5F5F7] outline-none focus:border-[#FF7A18] focus:ring-2 focus:ring-[#FF7A18]/20 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="flex items-center gap-2 text-xs text-[#A1A4AE]">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[#4ADE80]' : 'bg-[#DC2626]'}`} />
            {isConnected ? 'Live' : 'Reconnecting...'}
          </div>
        </div>

        {/* STATS */}
        <div className="flex flex-wrap gap-3 border-b border-[#202229] bg-[#15161C] px-3 py-2 text-[11px] sm:gap-4 sm:px-4 sm:text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#A1A4AE]">24h High</span>
            <span className="font-mono text-[#F5F5F7]">{formatUsd(high24h || 0)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#A1A4AE]">24h Low</span>
            <span className="font-mono text-[#F5F5F7]">{formatUsd(low24h || 0)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#A1A4AE]">Vol</span>
            <span className="font-mono text-[#F5F5F7]">{volume.toFixed(2)}</span>
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

          {/* ENTRY POSITION LINE (TradingView-style) */}
          {hasActiveTrade && entryLevelVisible && entryLabelTopPx !== null && (
              <>
                {/* Faint vertical marker for the entry TIME */}
                {entryChartX !== null && entryChartX > 0 && (
                    <div
                        className="pointer-events-none absolute bottom-0 top-0 z-10"
                        style={{ left: `${entryChartX}px` }}
                    >
                      <div
                          className={`h-full w-px ${
                              isLongDirection ? 'bg-[#4ADE80]' : 'bg-[#DC2626]'
                          } opacity-30`}
                      />
                    </div>
                )}

                {/* Horizontal line at the ENTRY PRICE level */}
                <div
                    className="pointer-events-none absolute left-0 right-0 z-10"
                    style={{ top: `${entryChartY ?? 0}px` }}
                >
                  <div
                      className={`h-[2px] w-full ${
                          isLongDirection ? 'bg-[#4ADE80]' : 'bg-[#DC2626]'
                      } opacity-80`}
                  />
                </div>

                {/* Price tag over the right price scale (exchange position
                    tool style) — shows the finalized entry price level. */}
                <div
                    className="pointer-events-none absolute right-0 z-20 flex -translate-y-1/2 items-center justify-center rounded-[3px] px-1 py-[3px] text-[9px] font-bold text-white shadow-md sm:text-[10px]"
                    style={{
                      top: `${entryChartY ?? 0}px`,
                      width: `${ENTRY_AXIS_TAG_WIDTH_PX}px`,
                      backgroundColor: isLongDirection ? '#4ADE80' : '#DC2626',
                    }}
                >
                  {formatUsd(entryPrice)}
                </div>

                {/* Single-row label sitting ON the line:
                    direction | stake | indicative move | countdown.
                    `clamp()` keeps the whole row inside the chart area
                    (and clear of the price-axis tag) on every viewport. */}
                <div
                    className={`pointer-events-none absolute z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-1 shadow-lg backdrop-blur-md ${
                        isLongDirection ? 'border-[#4ADE80]/60' : 'border-[#DC2626]/60'
                    } ${
                        liveMovePositive ? 'bg-[#0E1C14]/95' : 'bg-[#221111]/95'
                    }`}
                    style={{ left: `${entryLabelLeftPx}px`, top: `${entryLabelTopPx}px` }}
                >
                  <span
                      className={`text-[9px] font-bold ${
                          isLongDirection ? 'text-[#4ADE80]' : 'text-[#DC2626]'
                      }`}
                  >
                    {isLongDirection ? '▲ LONG' : '▼ SHORT'}
                  </span>
                  <span className="h-3.5 w-px bg-[#F5F5F7]/15" />
                  <span
                      className={`rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] font-bold text-white ${
                          isLongDirection ? 'bg-[#4ADE80]' : 'bg-[#DC2626]'
                      }`}
                  >
                    {formatStakeAmount(tradeStake)}
                  </span>
                  <span
                      className={`font-mono text-[10px] font-bold ${
                          liveMovePositive ? 'text-[#4ADE80]' : 'text-[#DC2626]'
                      }`}
                  >
                    {liveMovePositive ? '+' : '-'}
                    {Math.abs(liveMovePercent).toFixed(4)}%
                  </span>
                  <span className="h-3.5 w-px bg-[#F5F5F7]/15" />
                  <span
                      className={`font-mono text-[10px] font-bold ${
                          timerFinished ? 'text-[#FF7A18]' : 'text-[#F5F5F7]'
                      }`}
                  >
                    {timerFinished ? 'SETTLING' : formatCountdown(remainingMs)}
                  </span>
                </div>
              </>
          )}

          {/* EXPIRY VERTICAL LINE */}
          {hasActiveTrade && expiryChartX !== null && expiryChartX > 0 && (
              <>
                <div
                    className="pointer-events-none absolute bottom-0 top-0 z-10"
                    style={{ left: `${expiryChartX}px` }}
                >
                  <div className="h-full w-[2px] bg-[#FF7A18] opacity-80" />
                </div>
                <div
                    className="pointer-events-none absolute bottom-2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#FF7A18] px-2 py-1 text-[9px] font-bold text-white shadow-lg"
                    style={{
                      left: `clamp(${EXPIRY_LABEL_SAFE_HALF_PX}px, ${expiryChartX}px, calc(100% - ${EXPIRY_LABEL_SAFE_HALF_PX}px))`,
                    }}
                >
                  EXPIRY
                </div>
                <div
                    className="pointer-events-none absolute bottom-9 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#FF7A18]/40 bg-[#15161C]/90 px-2 py-1 font-mono text-[11px] font-bold text-[#FF7A18] backdrop-blur-md"
                    style={{
                      left: `clamp(${EXPIRY_LABEL_SAFE_HALF_PX}px, ${expiryChartX}px, calc(100% - ${EXPIRY_LABEL_SAFE_HALF_PX}px))`,
                    }}
                >
                  {timerFinished ? 'SETTLING...' : formatCountdown(remainingMs)}
                </div>
              </>
          )}

          {/* GLASS ACTIVE TRADE CARD (LIGHT) */}
          {hasActiveTrade && (
              <div
                  className="absolute z-30 max-w-[calc(100%-8px)]"
                  style={{
                    left: `${tradeCardLeftPx}px`,
                    top: `${tradeCardTopPx}px`,
                    width: `${tradeCardBounds.width}px`,
                    touchAction: 'none',
                  }}
              >
                <div
                    onPointerDown={handleCardPointerDown}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    onPointerCancel={handleCardPointerUp}
                    className={`relative overflow-hidden rounded-xl border border-[#34343E] bg-[#15161C]/80 shadow-[0_8px_32px_rgba(16,24,40,0.12)] backdrop-blur-xl backdrop-saturate-150 ${
                        isDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                >
                  {/* Glass Highlight */}
                  <div className="pointer-events-none absolute inset-0 bg-white/[0.03]" />
                  <div className="pointer-events-none absolute -left-8 -top-8 h-20 w-20 rounded-full bg-white/[0.06] blur-2xl" />

                  {/* Drag Handle */}
                  <div className="relative flex justify-center pt-1.5">
                    <div className="grid grid-cols-3 gap-[2px] rounded-full bg-[#1B1917] px-1.5 py-0.5">
                      {Array.from({ length: 6 }).map((_, index) => (
                          <span key={index} className="h-0.5 w-0.5 rounded-full bg-[#70737E]/30" />
                      ))}
                    </div>
                  </div>

                  {/* Header */}
                  <div className="relative flex items-center justify-between border-b border-[#202229] px-3 py-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                  <span
                      className={`text-sm font-bold ${
                          activeTrade?.direction === 'LONG' ? 'text-[#4ADE80]' : 'text-[#DC2626]'
                      }`}
                  >
                    {activeTrade?.direction === 'LONG' ? '▲' : '▼'}
                  </span>
                      <span
                          className={`text-sm font-bold ${
                              activeTrade?.direction === 'LONG' ? 'text-[#4ADE80]' : 'text-[#DC2626]'
                          }`}
                      >
                    {activeTrade?.direction}
                  </span>
                      <span className="truncate text-[10px] text-[#A1A4AE]">{activeTrade?.symbol}</span>
                    </div>
                    <span
                        className={`shrink-0 font-mono text-sm font-bold ${
                            timerFinished ? 'text-[#FF7A18]' : 'text-[#F5F5F7]'
                        }`}
                    >
                  {timerFinished ? '00:00' : formatCountdown(remainingMs)}
                </span>
                  </div>

                  {/* Entry / Current */}
                  <div className="relative grid grid-cols-2">
                    <div className="border-r border-[#202229] px-3 py-1.5">
                      <p className="text-[8px] uppercase tracking-wide text-[#A1A4AE]">Entry</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-[#F5F5F7]">
                        {formatUsd(entryPrice)}
                      </p>
                    </div>
                    <div className="px-3 py-1.5">
                      <p className="text-[8px] uppercase tracking-wide text-[#A1A4AE]">Current</p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-[#F5F5F7]">
                        {formatUsd(livePrice)}
                      </p>
                    </div>
                  </div>

                  {/* Indicative Move */}
                  <div className="relative flex items-center justify-between border-t border-[#202229] px-3 py-1.5">
                    <span className="text-[8px] text-[#A1A4AE]">Move</span>
                    <span
                        className={`font-mono text-xs font-bold ${
                            liveMovePositive ? 'text-[#4ADE80]' : 'text-[#DC2626]'
                        }`}
                    >
                  {liveMovePositive ? '▲' : '▼'} {Math.abs(liveMovePercent).toFixed(4)}%
                </span>
                  </div>

                  {/* Status */}
                  <div className="relative flex items-center justify-between border-t border-[#202229] px-3 py-1.5">
                    <span className="text-[8px] text-[#A1A4AE]">Status</span>
                    <span
                        className={`text-[10px] font-bold ${
                            timerFinished ? 'text-[#FF7A18]' : 'text-[#4ADE80]'
                        }`}
                    >
                  {timerFinished ? 'SETTLING' : 'ACTIVE'}
                </span>
                  </div>

                  {/* Drag Footer */}
                  <div className="relative flex items-center justify-center border-t border-[#202229] px-3 py-1">
                    <span className="text-[8px] text-[#70737E]">⋯ Drag</span>
                  </div>
                </div>
              </div>
          )}
        </div>

        {/* TIMEFRAMES */}
        <div className="overflow-x-auto border-t border-[#202229] bg-[#15161C] px-2.5 py-1.5 sm:px-4 sm:py-2">
          <div className="flex w-max min-w-full gap-1">
            {TIMEFRAMES.map((tf) => (
                <button
                    key={tf}
                    type="button"
                    onClick={() => setActiveInterval(tf)}
                    className={`whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs ${
                        activeInterval === tf
                            ? 'bg-[#FF7A18] text-[#F5F5F7] shadow-[0_2px_8px_rgba(255,122,24,0.3)]'
                            : 'text-[#A1A4AE] hover:bg-[#202229] hover:text-[#F5F5F7]'
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