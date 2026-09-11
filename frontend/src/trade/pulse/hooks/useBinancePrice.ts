// ============================================================
// BINANCE WEBSOCKET PRICE FEED
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PulsePair } from '../types';

const PAIR_MAP: Record<PulsePair, string> = {
  'BTC/USDT': 'btcusdt',
  'ETH/USDT': 'ethusdt',
  'BNB/USDT': 'bnbusdt',
  'SOL/USDT': 'solusdt',
};

export function useBinancePrice(pair: PulsePair) {
  const [price, setPrice] = useState<number>(64186.74);
  const [priceHistory, setPriceHistory] = useState<number[]>([64186.74]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const symbol = PAIR_MAP[pair];
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@trade`);

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.p) {
          const newPrice = parseFloat(data.p);
          setPrice(newPrice);
          setPriceHistory(prev => [...prev.slice(-199), newPrice]);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection error');
      setIsConnected(false);
      // Fallback: simulate price
      simulatePrice();
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    wsRef.current = ws;
    return ws;
  }, [pair]);

  const simulatePrice = useCallback(() => {
    setInterval(() => {
      setPrice(prev => prev + (Math.random() - 0.5) * 0.5);
      setPriceHistory(prev => [...prev.slice(-199), price]);
    }, 3000);
  }, [price]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const ws = connect();
    return () => ws?.close();
  }, [connect]);

  return {
    price,
    priceHistory,
    isConnected,
    error,
    reconnect: connect,
    disconnect,
  };
}