// ============================================================
// USE WITHDRAW HOOK
// ============================================================
//
// NEVER shows "Success" for a mere request submission.
 // Success is
// ONLY set when the BACKEND reports the withdrawal as COMPLETED
// (on-chain payout verified by the backend).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { WithdrawalService } from '../services/withdrawal.service';
import { WithdrawResult, WithdrawStatus } from '../types/withdrawal.types';
import {
  isWithdrawalTerminalFailure,
  isWithdrawalTerminalSuccess,
} from '../../statusMappings';

export function useWithdraw(_userId: string, onSuccess?: (result: WithdrawResult) => void) {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<WithdrawStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [withdrawalId, setWithdrawalId] = useState<string | null>(null);
  const [usdtAmount, setUsdtAmount] = useState<number>(0);
  const [tdxAmount, setTdxAmount] = useState<number>(0);
  const pollActiveRef = useRef(false);

  useEffect(() => {
    return () => {
      pollActiveRef.current = false;
    };
  }, []);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /**
   * Poll the backend withdrawal record until it reaches a terminal
   * state:
   * - COMPLETED → success (backend verified the on-chain payout).
   * - REJECTED / CANCELLED / FAILED → paymentNotDone.

   * Timeout → stay 'processing' (the backend remains authoritative;
   * the record can still advance later. History refresh shows the truth).
   */
  const trackWithdrawal = async (id: string) => {
    pollActiveRef.current = true;

    const MAX_ATTEMPTS = 75; // ~10 minutes at 8s interval
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && pollActiveRef.current; attempt++) {
      await sleep(8000);
      if (!pollActiveRef.current) return;

      try {
        const withdrawal = await WithdrawalService.getWithdrawalById(id);
        if (!withdrawal) continue;

        if (isWithdrawalTerminalSuccess(withdrawal.status)) {
          setStatus('success');
          setError(null);
          onSuccess?.({
            success: true,
            withdrawalId: id,
            usdtAmount: Number(withdrawal.usdtAmount),
            tdxAmount: Number(withdrawal.tdxAmount),
            status: withdrawal.status,
          });
          return;
        }

        if (isWithdrawalTerminalFailure(withdrawal.status)) {
          setStatus('paymentNotDone');
          setError('The withdrawal payment was not completed.');
          return;
        }

        // Otherwise keep 'processing' (Pending / Processing states..
      } catch {
        // Network / 404 — keep polling. Backend stays authoritative.

      }
    }

    pollActiveRef.current = false;
  };

  const withdraw = async (tdxAmountStr: string, walletAddress: string): Promise<WithdrawResult> => {
    // Validation
    if (!address || !isConnected) {
      setError('Please connect wallet first');
      return { success: false, error: 'Wallet not connected' };
    }

    const amountNum = parseFloat(tdxAmountStr);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount');
      return { success: false, error: 'Invalid amount' };
    }

    if (!walletAddress || !walletAddress.startsWith('0x')) {
      setError('Please enter a valid wallet address');
      return { success: false, error: 'Invalid address' };
    }

    try {
      setStatus('requesting');
      setError(null);

      // Request withdrawal from backend
      const response = await WithdrawalService.requestWithdrawal(
        walletAddress,
        tdxAmountStr,
      );

      setWithdrawalId(response.withdrawalId);
      setTdxAmount(amountNum);
      setUsdtAmount(parseFloat(response.usdtAmount));

      // The request was created — it is now PROCESSING (pending admin
      // approval / liquidity checks / payout verification. NOT success.),
      setStatus('processing');

      // Fire-and-forget backend polling: Success only on COMPLETED.


      void trackWithdrawal(response.withdrawalId);

      const result = {
        success: true,
        withdrawalId: response.withdrawalId,
        usdtAmount: parseFloat(response.usdtAmount),
        tdxAmount: amountNum,
        status: response.status,
      };

      return result;

    } catch (err) {
      setStatus('error');
      const message = err instanceof Error ? err.message : 'Withdrawal failed';
      setError(message);
      return { success: false, error: message };
    }
  };

  const reset = () => {
    pollActiveRef.current = false;
    setStatus('idle');
    setError(null);
    setWithdrawalId(null);
    setUsdtAmount(0);
    setTdxAmount(0);
  };

  return {
    withdraw,
    reset,
    status,
    error,
    withdrawalId,
    usdtAmount,
    tdxAmount,
    isLoading: status === 'requesting' || status === 'processing',
    isSuccess: status === 'success',
    isError: status === 'error' || status === 'paymentNotDone',
  };
}
