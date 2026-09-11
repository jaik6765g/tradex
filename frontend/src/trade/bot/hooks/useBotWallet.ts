// src/bot/hooks/useBot.ts

import { useState } from 'react';
import { apiClient } from '../../core/api/client';
import { useWalletContext } from '../../wallet/context/WalletContext';

export const useBot = () => {
  const { userId } = useWalletContext();
  const [mainBalance, setMainBalance] = useState<string>('0');
  const [botBalance, setBotBalance] = useState<string>('0');
  const [loading, setLoading] = useState(true);

  const fetchBotData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [mainRes, botRes] = await Promise.all([
        apiClient.get('/balances/me'),
        apiClient.get('/bot/wallet/balance'),
      ]);
      setMainBalance(mainRes.data?.availableBalance || '0');
      setBotBalance(botRes.data?.balance || '0');
    } catch (error) {
      console.error('Failed to fetch bot data:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    mainBalance,
    botBalance,
    loading,
    refetch: fetchBotData,
  };
};