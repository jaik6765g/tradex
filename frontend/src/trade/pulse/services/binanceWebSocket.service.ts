// src/trade/pulse/services/binanceWebSocket.service.ts

export type BinanceKlineData = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal: boolean;
};

export type BinanceTradeData = {
  price: number;
  volume: number;
  timestamp: number;
};

type Listener<T> = (data: T) => void;
type StreamListener = Listener<BinanceKlineData | BinanceTradeData>;

class BinanceWebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<StreamListener>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 2000;
  private reconnectTimer: number | null = null;
  private isConnected = false;
  private intentionallyClosed = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.intentionallyClosed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket('wss://stream.binance.com:9443/ws');

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emitConnectionStatus(true);

        const streams = Array.from(this.listeners.keys());
        if (streams.length > 0) {
          this.sendSubscribe(streams);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as unknown;
          this.handleMessage(payload);
        } catch {
          // ignore malformed payload
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.isConnected = false;
        this.emitConnectionStatus(false);

        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this.emitConnectionStatus(false);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimer !== null) return;

    this.reconnectAttempts += 1;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (streams.length === 0) return;

    this.ws.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: Date.now(),
      })
    );
  }

  private sendUnsubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (streams.length === 0) return;

    this.ws.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: streams,
        id: Date.now(),
      })
    );
  }

  private handleMessage(payload: unknown): void {
    const raw = payload as {
      id?: number;
      result?: unknown;
      stream?: string;
      data?: unknown;
      k?: unknown;
      p?: string | number;
      q?: string | number;
      T?: number;
      s?: string;
    };

    if (raw && raw.result !== undefined && raw.id !== undefined) {
      return;
    }

    const wrapped = Boolean(raw && raw.stream && raw.data);
    const streamName = wrapped ? raw.stream : undefined;
    const eventData = wrapped ? (raw.data as Record<string, unknown>) : (raw as Record<string, unknown>);

    if (!eventData || typeof eventData !== 'object') {
      return;
    }

    const k = eventData.k as
      | {
          t?: number;
          T?: number;
          o?: string;
          h?: string;
          l?: string;
          c?: string;
          v?: string;
          x?: boolean;
          i?: string;
        }
      | undefined;

    if (k && typeof k === 'object') {
      const klineData: BinanceKlineData = {
        openTime: Number(k.t),
        closeTime: Number(k.T),
        open: Number.parseFloat(String(k.o)),
        high: Number.parseFloat(String(k.h)),
        low: Number.parseFloat(String(k.l)),
        close: Number.parseFloat(String(k.c)),
        volume: Number.parseFloat(String(k.v)),
        isFinal: Boolean(k.x),
      };

      if (!this.isValidKline(klineData)) {
        return;
      }

      if (streamName) {
        this.notifyListeners(streamName, klineData);
      } else if (typeof eventData.s === 'string' && typeof k.i === 'string') {
        const fallbackStream = `${eventData.s.toLowerCase()}@kline_${k.i.toLowerCase()}`;
        this.notifyListeners(fallbackStream, klineData);
      }

      return;
    }

    const price = eventData.p;
    if (typeof price === 'string' || typeof price === 'number') {
      const tradeData: BinanceTradeData = {
        price: Number.parseFloat(String(price)),
        volume: Number.parseFloat(String(eventData.q ?? 0)),
        timestamp: Number(eventData.T ?? Date.now()),
      };

      if (!this.isValidTrade(tradeData)) {
        return;
      }

      if (streamName) {
        this.notifyListeners(streamName, tradeData);
      }
    }
  }

  private isValidKline(kline: BinanceKlineData): boolean {
    return (
      Number.isFinite(kline.openTime) &&
      Number.isFinite(kline.closeTime) &&
      Number.isFinite(kline.open) &&
      Number.isFinite(kline.high) &&
      Number.isFinite(kline.low) &&
      Number.isFinite(kline.close) &&
      Number.isFinite(kline.volume)
    );
  }

  private isValidTrade(trade: BinanceTradeData): boolean {
    return Number.isFinite(trade.price) && Number.isFinite(trade.volume) && Number.isFinite(trade.timestamp);
  }

  private notifyListeners(stream: string, payload: BinanceKlineData | BinanceTradeData): void {
    const callbacks = this.listeners.get(stream);
    if (!callbacks || callbacks.size === 0) return;

    callbacks.forEach((callback) => {
      try {
        callback(payload);
      } catch {
        // ignore listener errors
      }
    });
  }

  private emitConnectionStatus(connected: boolean): void {
    this.connectionListeners.forEach((callback) => {
      try {
        callback(connected);
      } catch {
        // ignore listener errors
      }
    });
  }

  public subscribe(stream: string, callback: StreamListener): () => void {
    if (!this.listeners.has(stream)) {
      this.listeners.set(stream, new Set());
      this.sendSubscribe([stream]);
    }

    this.listeners.get(stream)!.add(callback);

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }

    return () => this.unsubscribe(stream, callback);
  }

  private unsubscribe(stream: string, callback: StreamListener): void {
    const callbacks = this.listeners.get(stream);
    if (!callbacks) return;

    callbacks.delete(callback);

    if (callbacks.size === 0) {
      this.listeners.delete(stream);
      this.sendUnsubscribe([stream]);
    }
  }

  public subscribeConnectionStatus(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.add(callback);
    callback(this.isConnected);

    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }

    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  public disconnect(): void {
    this.intentionallyClosed = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.listeners.clear();
    this.connectionListeners.clear();
  }
}

export const binanceWebSocket = new BinanceWebSocketService();