import { useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useWriteContract,
  useReadContract,
  usePublicClient,
} from 'wagmi';
import { parseUnits, maxUint256 } from 'viem';

import {
  USDT_ADDRESS,
  VAULT_ADDRESS,
  USDT_ABI,
  VAULT_ABI,
  TDX_RATE,
  MIN_USDT_DEPOSIT,
  BSC_CHAIN_ID,
} from '../../config/wallet';

import {
  DepositResult,
  DepositStatus,
} from '../types/deposit.types';
import { DepositService } from '../services/deposit.service';

export function useDeposit(
  userId: string,
  onSuccess?: (result: DepositResult) => void,
) {
  const { address, isConnected, chainId } = useAccount();

  const publicClient = usePublicClient();

  const [status, setStatus] =
    useState<DepositStatus>('idle');

  const [error, setError] =
    useState<string | null>(null);

  const [txHash, setTxHash] =
    useState<string | null>(null);

  const [usdtAmount, setUsdtAmount] =
    useState<number>(0);

  const [tdxAmount, setTdxAmount] =
    useState<number>(0);

  const [isApproved, setIsApproved] =
    useState(false);

  const [isCheckingAllowance, setIsCheckingAllowance] =
    useState(false);

  const isSubmittingRef =
    useRef(false);

  // Polling lifecycle: stops on terminal backend statuses and is
  // cancelled on reset() or component unmount.
  const pollActiveRef = useRef(false);
  const pollCancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      pollCancelledRef.current = true;
      pollActiveRef.current = false;
    };
  }, []);

  const { writeContractAsync } =
    useWriteContract();

  const {
    refetch: refetchAllowance,
  } =
    useReadContract({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: 'allowance',
      args: address
        ? [address, VAULT_ADDRESS]
        : undefined,
      query: {
        enabled: !!address && !!isConnected,
      },
    });

  const checkAllowance = async () => {
    if (!address || !isConnected) {
      return;
    }

    setIsCheckingAllowance(true);

    try {
      const result = await refetchAllowance();

      const allowance =
        (result.data as bigint) || 0n;

      const MIN_ALLOWANCE =
        parseUnits('1000', 18);

      setIsApproved(
        allowance >= MIN_ALLOWANCE,
      );
    } catch (err) {
      console.error(
        'Error checking allowance:',
        err,
      );
    } finally {
      setIsCheckingAllowance(false);
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /**
   * Poll the BACKEND deposit status by tx hash until it reaches a
   * terminal state. Uses the poll-friendly endpoint
   * `GET /deposits/tx/:hash/status` which ALWAYS returns 200 (no 404
   * noise while the watcher has not detected the deposit yet).
   *
   * - COMPLETED + credited → backend has verified the blockchain
   *   transaction and CREDITED TDX (source of truth).
   * - FAILED               → terminal failure. No TDX was credited.
   * - found: false / PENDING / CONFIRMING / VERIFIED → keep polling.
   * - Timeout              → keep 'processing' (backend watcher can
   *   still reconcile the transaction; frontend never decides failure
   *   on a local timer alone).
   *
   * Polling stops on terminal statuses and when cancelled (reset or
   * component unmount).
   *
   * Returns: 'success' | 'notDone' | 'pending'.
   */
  const waitForBackendConfirmation = async (
    txHash: string,
  ): Promise<'success' | 'notDone' | 'pending'> => {
    pollActiveRef.current = true;

    const MAX_ATTEMPTS = 45; // ~3 minutes at 4s interval
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await sleep(4000);
      if (pollCancelledRef.current) {
        pollActiveRef.current = false;
        return 'pending';
      }

      try {
        const result = await DepositService.getDepositStatusByTxHash(txHash);

        // COMPLETED is only ever reported by the backend after
        // creditDeposit() succeeded (credited flag from creditedAt).
        if (result.found && result.status === 'COMPLETED' && result.credited) {
          pollActiveRef.current = false;
          return 'success';
        }

        if (result.found && result.status === 'FAILED') {
          pollActiveRef.current = false;
          return 'notDone';
        }

        // found: false (not yet detected) or PENDING/CONFIRMING/VERIFIED
        // → keep polling (backend watcher remains authoritative).
      } catch {
        // Network error — keep polling (backend stays authoritative).
      }
    }

    pollActiveRef.current = false;
    return 'pending';
  };

  const deposit = async (
    amount: string,
  ): Promise<DepositResult> => {
    if (isSubmittingRef.current) {
      const message =
        'Deposit is already in progress';

      return {
        success: false,
        error: message,
      };
    }

    if (!address || !isConnected) {
      const message =
        'Please connect wallet first';

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    if (!publicClient) {
      const message =
        'Blockchain client is not ready';

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    const normalizedAmount = amount.trim();

    const amountNum = Number(normalizedAmount);

    if (
      Number.isNaN(amountNum) ||
      amountNum <= 0
    ) {
      const message =
        'Please enter a valid amount';

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    if (amountNum < MIN_USDT_DEPOSIT) {
      const message =
        `Minimum deposit is ${MIN_USDT_DEPOSIT} USDT`;

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    if (chainId !== BSC_CHAIN_ID) {
      const message =
        'Please switch to BNB Smart Chain';

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    if (
      !/^\d+(\.\d{1,18})?$/.test(normalizedAmount)
    ) {
      const message =
        'Amount supports up to 18 decimal places';

      setError(message);

      return {
        success: false,
        error: message,
      };
    }

    try {
      isSubmittingRef.current = true;

      // Re-arm backend status polling for this deposit attempt.
      pollCancelledRef.current = false;

      setError(null);
      setStatus('approving');

      const amountWei =
        parseUnits(normalizedAmount, 18);

      // ================================================
      // CHECK ALLOWANCE
      // ================================================

      const allowanceResult =
        await refetchAllowance();

      const allowance =
        (allowanceResult.data as bigint) || 0n;

      // ================================================
      // APPROVE
      // ================================================

      if (allowance < amountWei) {
        console.info(
          'TradeX deposit: submitting USDT approval',
          {
            walletAddress: address,
            vaultAddress: VAULT_ADDRESS,
            amount: normalizedAmount,
          },
        );

        const approvalHash =
          await writeContractAsync({
            address: USDT_ADDRESS,
            abi: USDT_ABI,
            functionName: 'approve',
            args: [
              VAULT_ADDRESS,
              maxUint256,
            ],
          });

        console.info(
          'TradeX deposit: approval submitted',
          approvalHash,
        );

        await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        });

        console.info(
          'TradeX deposit: approval confirmed',
          approvalHash,
        );

        setIsApproved(true);
      }

      // ================================================
      // DEPOSIT
      // ================================================

      setStatus('depositing');

      console.info(
        'TradeX deposit: submitting depositUSDT',
        {
          walletAddress: address,
          vaultAddress: VAULT_ADDRESS,
            amount: normalizedAmount,
        },
      );

      const depositHash =
        await writeContractAsync({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: 'depositUSDT',
          args: [amountWei],
        });

      console.info(
        'TradeX deposit: deposit submitted',
        depositHash,
      );

      setTxHash(depositHash);

      // ================================================
      // WAIT FOR BLOCKCHAIN CONFIRMATION
      // ================================================

      const receipt =
        await publicClient.waitForTransactionReceipt({
          hash: depositHash,
        });

      if (receipt.status !== 'success') {
        setStatus('paymentNotDone');
        setError('The deposit transaction was reverted on the blockchain. No TDX was credited.');

        return {
          success: false,
          error: 'The deposit transaction was reverted on the blockchain. No TDX was credited.',
        };
      }

      // ================================================
      // BLOCKCHAIN SUBMITTED → BACKEND VERIFICATION
      // ================================================
      //
      // The receipt only proves the tx was mined. It does NOT prove
      // the backend detected, verified, and credited the deposit.
      //
      // Never show Success until the BACKEND reports COMPLETED
      // (which only happens after TDX credit).
      // ================================================

      const tdx =
        amountNum * TDX_RATE;

      setUsdtAmount(amountNum);
      setTdxAmount(tdx);
      setTxHash(depositHash);

      // Show "Processing payment..." while the backend watcher detects →
      // verifies → credits the deposit.

      setStatus('processing');

      const verification =
        await waitForBackendConfirmation(depositHash);

      if (verification === 'success') {
        setStatus('success');
        setError(null);

        const result: DepositResult = {
          success: true,
          txHash: depositHash,
          usdtAmount: amountNum,
          tdxAmount: tdx,
        };

        onSuccess?.(result);

        return result;
      }

      if (verification === 'notDone') {
        setStatus('paymentNotDone');
        setError('The payment was not completed. No TDX was credited.');

        return {
          success: false,
          error: 'The payment was not completed. No TDX was credited.',
        };
      }

      // Verification still pending after the frontend polling window. Keep
      // 'processing' — the backend watcher remains authoritative and can
      // still reconcile the deposit later. History/balance refresh will
      // reflect the backend state.



      return {
        success: false,
        txHash: depositHash,
      };

    } catch (err) {
      console.error(
        'TradeX deposit failed:',
        err,
      );

      const message =
        err instanceof Error
          ? err.message
          : 'Deposit failed';

      const lower = message.toLowerCase();
      const isWalletRejection =
        lower.includes('user rejected')
        || lower.includes('user denied')
        || lower.includes('rejected the request')
        || lower.includes('action_rejected')
        || lower.includes('user cancelled')
        || lower.includes('user canceled')
        || lower.includes('transaction was reverted')
        || lower.includes('execution reverted');

      if (isWalletRejection) {
        setStatus('paymentNotDone');
        setError('Payment was not completed. No TDX was credited.');
      } else {
        setStatus('error');
        setError(message);
      }

      return {
        success: false,
        error: message,
      };
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const reset = () => {
    pollCancelledRef.current = true;
    pollActiveRef.current = false;
    setStatus('idle');
    setError(null);
    setTxHash(null);
    setUsdtAmount(0);
    setTdxAmount(0);
  };

  return {
    deposit,
    reset,
    checkAllowance,
    status,
    error,
    txHash,
    usdtAmount,
    tdxAmount,

    isLoading:
      status === 'approving' ||
      status === 'depositing' ||
      status === 'processing' ||
      isCheckingAllowance,

    isSuccess:
      status === 'success',

    isError:
      status === 'error',

    isApproved,
    isCheckingAllowance,

    calculateTDX: (
      amount: number,
    ) => amount * TDX_RATE,
  };
}