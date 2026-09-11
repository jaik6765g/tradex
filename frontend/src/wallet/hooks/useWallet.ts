// ============================================================
// TRADEX WALLET HOOK
// ============================================================

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  useAccount,
  useConnect,
  useSignMessage,
  useSwitchChain,
} from 'wagmi';

import { appKit } from '../config/webWallet';

import {
  WalletService,
  type BalanceResponse,
} from '../services/wallet.service';

import type {
  WalletBalance,
  Transaction,
  WalletState,
} from '../types/wallet.types';

import {
  CHAIN_IDS,
} from '../config/networks';

import {
  AuthService,
} from '../../auth/services/auth.service';
import type { AuthUser } from '../../auth/hooks/auth.types';

// ============================================================
// CONSTANTS
// ============================================================

const REQUIRED_CHAIN_ID =
  CHAIN_IDS.BSC_MAINNET;

const REQUIRED_NETWORK_NAME =
  'BNB Smart Chain';

// ============================================================
// INITIAL STATE
// ============================================================

const initialState: WalletState = {
  balance: {
    usdt: '0',
    tdx: '0',
    native: '0',
    nativeSymbol: 'BNB',
    tdxAvailable: '0',
    tdxLocked: '0',
    tdxTotal: '0',
    gameLocked: '0',
    tradingLocked: '0',
    withdrawalLocked: '0',
  },

  transactions: [],

  isLoading: false,
  isConnecting: false,

  error: null,

  isConnected: false,
  isWrongNetwork: false,

  requiredChainId:
    REQUIRED_CHAIN_ID,

  requiredNetworkName:
    REQUIRED_NETWORK_NAME,

  address: null,
  chainId: null,
};

// ============================================================
// HOOK
// ============================================================

export function useWallet() {
  // ==========================================================
  // WAGMI
  // ==========================================================

  const {
    address,
    isConnected,
    chainId,
    status,
  } = useAccount();

  const {
    isPending: isConnectPending,
  } = useConnect();

  const {
    switchChainAsync,
    isPending:
      isSwitchingNetwork,
  } = useSwitchChain();

  const {
    signMessageAsync,
  } = useSignMessage();

  // ==========================================================
  // STATE
  // ==========================================================

  const [
    state,
    setState,
  ] = useState<WalletState>(
    initialState,
  );

  const [
    user,
    setUser,
  ] = useState<AuthUser | null>(
    () =>
      AuthService.getSavedUser(),
  );

  // ==========================================================
  // DERIVED AUTH STATE
  // ==========================================================

  const isAuthenticated =
    Boolean(
      user &&
      AuthService.getToken(),
    );

  const userId =
    user?.id || '';

  // ==========================================================
  // WRONG NETWORK
  // ==========================================================

  const isWrongNetwork =
    Boolean(
      isConnected &&
      chainId !== undefined &&
      chainId !== REQUIRED_CHAIN_ID,
    );

  // ==========================================================
  // GET REFERRAL CODE
  // ==========================================================

  const getReferralCode =
    useCallback(() => {
      if (
        typeof window ===
        'undefined'
      ) {
        return undefined;
      }

      const params =
        new URLSearchParams(
          window.location.search,
        );

      const urlReferral =
        params.get('ref');

      if (urlReferral) {
        const normalized =
          urlReferral
            .trim()
            .toUpperCase();

        if (normalized) {
          localStorage.setItem(
            'tradex_referral_code',
            normalized,
          );

          return normalized;
        }
      }

      return (
        localStorage.getItem(
          'tradex_referral_code',
        ) || undefined
      );
    }, []);

  // ============================================================
  // FETCH BALANCE
  // ============================================================

  const fetchBalance =
    useCallback(async () => {
      if (!isAuthenticated) {
        return;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      try {
        const balance =
          await WalletService.getMyBalance();

        const available =
          Number(
            balance.availableBalance ?? 0,
          );

        const locked =
          Number(
            balance.lockedBalance ?? 0,
          );

        const total =
          Number(
            balance.totalBalance ?? 0,
          );

        setState((prev) => ({
          ...prev,

          balance: {
            ...prev.balance,

            // Backend TDX balance
            tdx: available.toString(),
            tdxAvailable: available.toString(),
            tdxLocked: locked.toString(),
            tdxTotal: total.toString(),
            gameLocked: prev.balance.gameLocked,
            tradingLocked: prev.balance.tradingLocked,
            withdrawalLocked: prev.balance.withdrawalLocked,

            native:
              available.toString(),

            nativeSymbol:
              'TDX',
          },

          isLoading: false,
        }));

        // Keep values available
        // for UI/debugging.
        void locked;
        void total;
      } catch (error) {
        setState((prev) => ({
          ...prev,

          isLoading: false,

          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch balance',
        }));
      }
    }, [
      isAuthenticated,
    ]);

  // ============================================================
  // FETCH TRANSACTIONS
  // ============================================================

  const fetchTransactions =
    useCallback(async () => {
      if (!isAuthenticated) {
        return;
      }

      try {
        const transactions =
          await WalletService.getTransactionHistory(
            userId,
          );

        setState((prev) => ({
          ...prev,
          transactions,
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,

          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch transactions',
        }));
      }
    }, [
      isAuthenticated,
      userId,
    ]);

  // ============================================================
  // REFRESH
  // ============================================================

  const refresh =
    useCallback(async () => {
      if (!isAuthenticated) {
        return;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      try {
        await Promise.all([
          fetchBalance(),
          fetchTransactions(),
        ]);
      } catch (error) {
        setState((prev) => ({
          ...prev,

          error:
            error instanceof Error
              ? error.message
              : 'Failed to refresh wallet',
        }));
      } finally {
        setState((prev) => ({
          ...prev,
          isLoading: false,
        }));
      }
    }, [
      isAuthenticated,
      fetchBalance,
      fetchTransactions,
    ]);

  // ============================================================
  // AUTHENTICATE
  // ============================================================

  const authenticate =
    useCallback(async () => {
      if (!address) {
        throw new Error(
          'Wallet is not connected',
        );
      }

      if (
        chainId !==
        REQUIRED_CHAIN_ID
      ) {
        throw new Error(
          `Please switch to ${REQUIRED_NETWORK_NAME}`,
        );
      }

      setState((prev) => ({
        ...prev,

        isConnecting: true,
        error: null,
      }));

      try {
        // ------------------------------------------------------
        // 1. Get backend nonce
        // ------------------------------------------------------

        const nonceResponse =
          await AuthService.getNonce(
            address,
          );

        // ------------------------------------------------------
        // 2. Sign backend message
        // ------------------------------------------------------

        const signature =
          await signMessageAsync({
            message:
              nonceResponse.message,
          });

        // ------------------------------------------------------
        // 3. Referral
        // ------------------------------------------------------

        const referralCode =
          getReferralCode();

        // ------------------------------------------------------
        // 4. Verify
        // ------------------------------------------------------

        const authResponse =
          await AuthService.verifySignature(
            {
              walletAddress:
                address,

              signature,

              nonce:
                nonceResponse.nonce,

              chainId:
                REQUIRED_CHAIN_ID,

              ...(referralCode
                ? {
                    referralCode,
                  }
                : {}),
            },
          );

        // ------------------------------------------------------
        // 5. Save JWT
        // ------------------------------------------------------

        if (!authResponse.accessToken) {
          throw new Error('Auth access token missing');
        }

        AuthService.saveToken(
          authResponse.accessToken,
        );

        // ------------------------------------------------------
        // 6. Save user
        // ------------------------------------------------------

        if (!authResponse.user) {
          throw new Error('Auth user payload missing');
        }

        AuthService.saveUser(
          authResponse.user,
        );

        setUser(
          authResponse.user,
        );

        // ------------------------------------------------------
        // 7. Referral is now consumed
        // ------------------------------------------------------

        localStorage.removeItem(
          'tradex_referral_code',
        );

        // ------------------------------------------------------
        // 8. Update wallet state
        // ------------------------------------------------------

        setState((prev) => ({
          ...prev,

          isConnected: true,

          address,

          chainId:
            REQUIRED_CHAIN_ID,

          isWrongNetwork:
            false,

          error: null,
        }));

        // ------------------------------------------------------
        // 9. Load backend data
        // ------------------------------------------------------

        await Promise.all([
          fetchBalance(),
          fetchTransactions(),
        ]);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Wallet authentication failed';

        setState((prev) => ({
          ...prev,

          isConnecting: false,
          error: message,
        }));

        throw error;
      }

      setState((prev) => ({
        ...prev,
        isConnecting: false,
      }));
    }, [
      address,
      chainId,
      signMessageAsync,
      getReferralCode,
      fetchBalance,
      fetchTransactions,
    ]);

  // ============================================================
  // UPDATE BALANCE
  // ============================================================

  const updateBalance =
    useCallback(
      (
        newBalance:
          Partial<WalletBalance>,
      ) => {
        setState((prev) => ({
          ...prev,

          balance: {
            ...prev.balance,
            ...newBalance,
          },
        }));
      },
      [],
    );

  // ============================================================
  // ADD TRANSACTION
  // ============================================================

  const addTransaction =
    useCallback(
      (
        transaction: Transaction,
      ) => {
        setState((prev) => ({
          ...prev,

          transactions: [
            transaction,
            ...prev.transactions,
          ],
        }));
      },
      [],
    );

  // ============================================================
  // OPEN WALLET
  // ============================================================

  const openWallet =
    useCallback(() => {
      appKit.open();
    }, []);

  // ============================================================
  // DISCONNECT
  // ============================================================

  const disconnectWallet =
    useCallback(async () => {
      AuthService.clearSession();

      setUser(null);

      setState(
        initialState,
      );

      await appKit.disconnect();
    }, []);

  // ============================================================
  // SWITCH NETWORK
  // ============================================================

  const switchToRequiredNetwork =
    useCallback(async () => {
      if (
        chainId ===
        REQUIRED_CHAIN_ID
      ) {
        return;
      }

      await switchChainAsync({
        chainId:
          REQUIRED_CHAIN_ID,
      });
    }, [
      chainId,
      switchChainAsync,
    ]);

  // ============================================================
  // WALLET CONNECTION EFFECT
  // ============================================================

  useEffect(() => {
    const walletIsConnecting =
      status === 'connecting' ||
      status === 'reconnecting' ||
      isConnectPending ||
      isSwitchingNetwork;

    // ----------------------------------------------------------
    // DISCONNECTED
    // ----------------------------------------------------------

    if (
      !isConnected ||
      !address
    ) {
      setState((prev) => ({
        ...initialState,

        isConnecting:
          walletIsConnecting,

        transactions:
          prev.transactions,
      }));

      return;
    }

    // ----------------------------------------------------------
    // CONNECTED
    // ----------------------------------------------------------

    setState((prev) => ({
      ...prev,

      isConnected: true,

      address,

      chainId:
        chainId ?? null,

      isConnecting:
        walletIsConnecting,

      isWrongNetwork,
    }));
  }, [
    isConnected,
    address,
    chainId,
    status,
    isConnectPending,
    isSwitchingNetwork,
    isWrongNetwork,
  ]);

  // ============================================================
  // AUTO AUTH AFTER CONNECT
  // ============================================================

  useEffect(() => {
    if (
      !isConnected ||
      !address
    ) {
      return;
    }

    if (
      chainId !==
      REQUIRED_CHAIN_ID
    ) {
      return;
    }

    if (
      AuthService.getToken() &&
      user
    ) {
      return;
    }

    void authenticate();
  }, [
    isConnected,
    address,
    chainId,
    user,
    authenticate,
  ]);

  // ============================================================
  // AUTO REFRESH
  // ============================================================

  useEffect(() => {
    if (
      !isAuthenticated ||
      isWrongNetwork
    ) {
      return;
    }

    void refresh();
  }, [
    isAuthenticated,
    isWrongNetwork,
    refresh,
  ]);

  // ============================================================
  // RETURN
  // ============================================================

  return {
    ...state,

    userId,

    user,

    isAuthenticated,

    isConnecting:
      state.isConnecting ||
      isSwitchingNetwork,

    referralCode:
      user?.referralCode ||
      '',

    referredBy:
      user?.referredBy ||
      null,

    authenticate,

    refresh,

    openWallet,

    disconnectWallet,

    switchToRequiredNetwork,

    fetchBalance,

    fetchTransactions,

    updateBalance,

    addTransaction,
  };
}

// ============================================================
// BACKEND BALANCE HOOK
// ============================================================

export function useBalance() {
  const [
    balance,
    setBalance,
  ] = useState<
    BalanceResponse | undefined
  >(undefined);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<
    string | undefined
  >(undefined);

  const refresh =
    useCallback(async () => {
      setLoading(true);
      setError(undefined);

      try {
        const nextBalance =
          await WalletService.getMyBalance();

        setBalance(
          nextBalance,
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to load balance';

        setError(message);
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    if (
      AuthService.getToken()
    ) {
      void refresh();
    } else {
      setLoading(false);
    }
  }, [refresh]);

  return {
    balance,
    loading,
    error,
    refresh,
  };
}
