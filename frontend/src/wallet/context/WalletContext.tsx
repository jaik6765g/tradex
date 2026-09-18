import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useAccount,
  useBalance as useWagmiBalance,
  useSignMessage,
  useSwitchChain,
  useReadContract,
} from 'wagmi';
import { formatUnits } from 'viem';

import { appKit } from '../config/webWallet';
import { WalletService } from '../services/wallet.service';
import type { WalletBalance, Transaction } from '../types/wallet.types';
import { CHAIN_IDS } from '../config/networks';
import { USDT_ADDRESS, USDT_ABI } from '../config/wallet';
import { AuthService } from '../../auth/services/auth.service';
import { useAppAuth } from '../../auth/authContext';
import type { AuthUser, AuthWallet } from '../../auth/hooks/auth.types';

const REQUIRED_CHAIN_ID = CHAIN_IDS.BSC_MAINNET;
const REQUIRED_NETWORK_NAME = 'BNB Smart Chain';

const INITIAL_BALANCE: WalletBalance = {
  usdt: '0',
  native: '0',
  nativeSymbol: 'BNB',
  tdx: '0',
  tdxAvailable: '0',
  tdxLocked: '0',
  tdxTotal: '0',
  gameLocked: '0',
  tradingLocked: '0',
  withdrawalLocked: '0',
};

interface WalletContextType {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
  isWrongNetwork: boolean;
  requiredChainId: number;
  requiredNetworkName: string;
  isConnecting: boolean;
  openWallet: () => void;
  disconnectWallet: () => Promise<void>;
  switchToRequiredNetwork: () => Promise<void>;
  authUser: AuthUser | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  authenticateWallet: () => Promise<void>;
  retryAuth: () => Promise<void>;
  clearAuthError: () => void;
  logout: () => Promise<void>;
  registrationRequired: boolean;
  registrationWalletAddress: string | null;
  registrationChainId: number | null;
  registrationToken: string | null;
  registerWallet: (referralCode?: string) => Promise<void>;
  cancelRegistration: () => void;
  isRegistering: boolean;
  registrationError: string | null;
  userId: string;
  balance: WalletBalance;
  usdtBalance: string;
  tdxBalance: string;
  nativeBalance: string;
  nativeSymbol: string;
  isLoading: boolean;
  error: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  fetchBalance: (options?: { silent?: boolean }) => Promise<void>;
  fetchTransactions: () => Promise<void>;
  updateBalance: (balance: Partial<WalletBalance>) => void;
  addTransaction: (transaction: Transaction) => void;
  transactions: Transaction[];
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// HIGH-002: an unchanged balance must not allocate a new object. A fresh
// object per fetch used to change the context value identity on every poll
// cycle and re-render every useWalletContext() consumer app-wide.
const isSameBalance = (prev: WalletBalance, next: WalletBalance): boolean =>
  (Object.keys(next) as Array<keyof WalletBalance>).every(
    (key) => prev[key] === next[key],
  );

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, chainId, status } = useAccount();
  const auth = useAppAuth();

  const nativeBalanceParams = useMemo(
    () => ({ address: address ?? undefined }),
    [address],
  );
  const { data: nativeData } = useWagmiBalance(nativeBalanceParams);
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: isSwitchingNetwork } = useSwitchChain();

  const usdtReadQuery = useMemo(
    () => ({
      enabled: !!address && !!isConnected,
      refetchInterval: 10000,
    }),
    [address, isConnected],
  );
  const usdtReadParams = useMemo(
    () => ({
      address: USDT_ADDRESS,
      abi: USDT_ABI,
      functionName: 'balanceOf' as const,
      args: address ? ([address] as const) : undefined,
      query: usdtReadQuery,
    }),
    [address, usdtReadQuery],
  );
  const { refetch: refetchUSDT } = useReadContract(usdtReadParams);

  const [balance, setBalance] = useState<WalletBalance>(INITIAL_BALANCE);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // HIGH-002: memoised JSON signature of the last transaction list, so
  // unchanged ledger data never reallocates the context value.
  const transactionsSignatureRef = useRef('');

  const userId = auth.userId;
  const authUser = auth.user;

  const isWrongNetwork =
    !!isConnected && chainId !== null && chainId !== REQUIRED_CHAIN_ID;
  const isConnecting =
    status === 'connecting' || status === 'reconnecting' || isSwitchingNetwork;

  const formatBalance = (value: number): string => Number(value).toFixed(2);

  // HIGH-002: `silent` marks a BACKGROUND refresh (e.g. the Lotto 5s poll).
  // A silent refresh must not toggle `isLoading` — that flag is part of the
  // context value, so toggling it twice per poll re-rendered every
  // useWalletContext() consumer app-wide. Genuine errors are still recorded.
  const fetchBalance = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!userId || !AuthService.getToken()) {
      return;
    }

    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const response = await WalletService.getMyBalance();

      let usdtBalance = '0';
      if (address && isConnected) {
        try {
          const result = await refetchUSDT();
          if (result.data) {
            usdtBalance = Number(
              Number(formatUnits(result.data as bigint, 18)).toFixed(2),
            ).toString();
          }
        } catch {
          // ignore on-chain USDT read failure
        }
      }

      const nativeBalance =
        nativeData?.value !== undefined
          ? Number(
              Number(
                formatUnits(nativeData.value, nativeData.decimals),
              ).toFixed(6),
            ).toString()
          : null;

      // HIGH-002: diff before set — identical values keep the SAME balance
      // object identity, so the context value memo does not recompute and
      // consumers do not re-render. The previous native value is read
      // functionally (prev.native) so `balance` is NOT needed in deps.
      setBalance((prev) => {
        const next: WalletBalance = {
          usdt: usdtBalance,
          native: nativeBalance ?? prev.native,
          nativeSymbol: nativeData?.symbol || 'BNB',
          tdx: formatBalance(response.availableBalance ?? 0),
          tdxAvailable: formatBalance(response.availableBalance ?? 0),
          tdxLocked: formatBalance(response.lockedBalance ?? 0),
          tdxTotal: formatBalance(response.totalBalance ?? 0),
          gameLocked: formatBalance(response.gameLocked ?? 0),
          tradingLocked: formatBalance(response.tradingLocked ?? 0),
          withdrawalLocked: formatBalance(response.withdrawalLocked ?? 0),
        };
        return isSameBalance(prev, next) ? prev : next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [userId, nativeData, address, isConnected, refetchUSDT]);
const fetchTransactions = useCallback(async () => {
    if (!userId || !AuthService.getToken()) {
      return;
    }

    try {
      const list = await WalletService.getTransactionHistory(userId);
      // HIGH-002: skip the state update when the ledger list is unchanged —
      // a fresh array of new objects per fetch used to change context
      // identity on every poll cycle even when nothing visibly changed.
      const signature = JSON.stringify(list);
      setTransactions((prev) => {
        if (signature === transactionsSignatureRef.current) {
          return prev;
        }
        transactionsSignatureRef.current = signature;
        return list;
      });
    } catch {
      // ignore
    }
  }, [userId]);

  // HIGH-002: `options` is forwarded to fetchBalance so polling callers can
  // request a silent background refresh. Default {} keeps every existing
  // call site's behaviour identical.
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!userId || !AuthService.getToken()) {
      return;
    }

    await Promise.all([fetchBalance(options), fetchTransactions()]);
  }, [userId, fetchBalance, fetchTransactions]);

  const updateBalance = useCallback((next: Partial<WalletBalance>) => {
    // HIGH-002: same identity guard as fetchBalance — a no-op merge must not
    // allocate a new balance object.
    setBalance((prev) => {
      const merged: WalletBalance = { ...prev, ...next };
      return isSameBalance(prev, merged) ? prev : merged;
    });
  }, []);

  const addTransaction = useCallback((tx: Transaction) => {
    // HIGH-002: a locally added transaction changes the list — invalidate the
    // memoised signature so the next fetch applies the server's view.
    transactionsSignatureRef.current = '';
    setTransactions((prev) => [tx, ...prev]);
  }, []);

  const openWallet = useCallback(() => {
    appKit.open();
  }, []);

  const clearAuthError = useCallback(() => {}, []);

  const buildOwnershipMessage = useCallback((walletAddress: string) => {
    return [
      'TradeX Wallet Ownership Proof',
      '',
      `Address: ${walletAddress}`,
      `Timestamp: ${Date.now()}`,
    ].join('\n');
  }, []);

  const linkWallet = useCallback(async (): Promise<AuthWallet> => {
    if (!address || !isConnected) {
      throw new Error('Wallet not connected');
    }

    if (isWrongNetwork) {
      throw new Error(`Please switch to ${REQUIRED_NETWORK_NAME}`);
    }

    const message = buildOwnershipMessage(address);
    const signature = await signMessageAsync({ message });

    return auth.linkWallet({
      walletAddress: address,
      signature,
      message,
      chainId: chainId ?? REQUIRED_CHAIN_ID,
    });
  }, [
    address,
    isConnected,
    isWrongNetwork,
    chainId,
    signMessageAsync,
    auth,
    buildOwnershipMessage,
  ]);

  const authenticateWallet = useCallback(async () => {
    await linkWallet();
  }, [linkWallet]);

  const retryAuth = useCallback(async () => {
    await linkWallet();
  }, [linkWallet]);

  // Registration is replaced by mobile signup — keep stubs for compatibility.
  const registrationRequired = false;
  const registrationWalletAddress = null;
  const registrationChainId = null;
  const registrationToken = null;
  const isRegistering = false;
  const registrationError = null;

  const registerWallet = useCallback(async () => {
    throw new Error('Wallet registration removed — sign up with your mobile number');
  }, []);

  const cancelRegistration = useCallback(() => {}, []);

  const logout = useCallback(async () => {
    await auth.logout();
    setBalance(INITIAL_BALANCE);
    setTransactions([]);
    // HIGH-002: reset the memoised transaction signature so the next
    // session's first fetch always applies fresh data.
    transactionsSignatureRef.current = '';
    setError(null);

    try {
      await appKit.disconnect();
    } catch {
      // ignore
    }
  }, [auth]);

  const disconnectWallet = useCallback(async () => {
    try {
      await appKit.disconnect();
    } catch {
      // ignore
    }
  }, []);

  const switchToRequiredNetwork = useCallback(async () => {
    if (chainId === REQUIRED_CHAIN_ID) {
      return;
    }

    try {
      await switchChainAsync({ chainId: REQUIRED_CHAIN_ID });
    } catch (err) {
      throw err;
    }
  }, [chainId, switchChainAsync]);

  useEffect(() => {
    if (!userId || !isConnected || isWrongNetwork || !AuthService.getToken()) {
      return;
    }

    void refresh();
  }, [userId, isConnected, isWrongNetwork, refresh]);
const value = useMemo<WalletContextType>(
    () => ({
      address: address ?? null,
      isConnected: !!isConnected,
      chainId: chainId ?? null,
      isWrongNetwork,
      requiredChainId: REQUIRED_CHAIN_ID,
      requiredNetworkName: REQUIRED_NETWORK_NAME,
      isConnecting,
      openWallet,
      disconnectWallet,
      switchToRequiredNetwork,
      authUser,
      isAdmin: auth.isAdmin,
      isAuthenticated: auth.isAuthenticated,
      isAuthenticating: auth.isAuthenticating,
      authError: auth.authError,
      authenticateWallet,
      retryAuth,
      clearAuthError,
      logout,
      registrationRequired,
      registrationWalletAddress,
      registrationChainId,
      registrationToken,
      registerWallet,
      cancelRegistration,
      isRegistering,
      registrationError,
      userId,
      balance,
      usdtBalance: balance.usdt,
      tdxBalance: balance.tdx,
      nativeBalance: balance.native,
      nativeSymbol: balance.nativeSymbol,
      isLoading,
      error,
      refresh,
      fetchBalance,
      fetchTransactions,
      updateBalance,
      addTransaction,
      transactions,
    }),
    [
      address,
      isConnected,
      chainId,
      isWrongNetwork,
      isConnecting,
      openWallet,
      disconnectWallet,
      switchToRequiredNetwork,
      authUser,
      auth.isAdmin,
      auth.isAuthenticated,
      auth.isAuthenticating,
      auth.authError,
      authenticateWallet,
      retryAuth,
      clearAuthError,
      logout,
      registrationRequired,
      registrationWalletAddress,
      registrationChainId,
      registrationToken,
      registerWallet,
      cancelRegistration,
      isRegistering,
      registrationError,
      userId,
      balance,
      isLoading,
      error,
      refresh,
      fetchBalance,
      fetchTransactions,
      updateBalance,
      addTransaction,
      transactions,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);

  if (!ctx) {
    throw new Error('useWallet must be used within WalletProvider');
  }

  return ctx;
}

export const useWalletContext = useWallet;