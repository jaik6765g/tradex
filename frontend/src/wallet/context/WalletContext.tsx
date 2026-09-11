// ============================================================
// TRADEX WALLET CONTEXT
// ============================================================

import React, { createContext, useContext, ReactNode, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAccount, useBalance as useWagmiBalance, useSignMessage, useSwitchChain, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { appKit } from '../config/webWallet';
import { WalletService } from '../services/wallet.service';
import type { WalletBalance, Transaction } from '../types/wallet.types';
import { CHAIN_IDS } from '../config/networks';
import { AuthService } from '../../auth/services/auth.service';
import type { AuthUser } from '../../auth/hooks/auth.types';
import { USDT_ADDRESS, USDT_ABI } from '../config/wallet';

const REQUIRED_CHAIN_ID = CHAIN_IDS.BSC_MAINNET;
const REQUIRED_NETWORK_NAME = 'BNB Smart Chain';
const REFERRAL_STORAGE_KEY = 'tradex_referral_code';

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
  refresh: () => Promise<void>;
  fetchBalance: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  updateBalance: (balance: Partial<WalletBalance>) => void;
  addTransaction: (transaction: Transaction) => void;
  transactions: Transaction[];
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId, status } = useAccount();
  // Hook params must have STABLE identity across renders: recreating inline
  // objects makes wagmi's internal store emit during another component's
  // render (Hydrate) -> React warning "Cannot update a component
  // (WalletProvider) while rendering a different component (Hydrate)".
  const nativeBalanceParams = useMemo(
    () => ({ address: address ?? undefined }),
    [address],
  );
  const { data: nativeData } = useWagmiBalance(nativeBalanceParams);
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage();
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
  const { data: usdtBalanceData, refetch: refetchUSDT } = useReadContract(usdtReadParams);

  const [balance, setBalance] = useState<WalletBalance>(INITIAL_BALANCE);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [registrationWalletAddress, setRegistrationWalletAddress] = useState<string | null>(null);
  const [registrationChainId, setRegistrationChainId] = useState<number | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [registrationReferralCode, setRegistrationReferralCode] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  const authAttemptRef = useRef<string | null>(null);
  const registrationWalletRef = useRef<string | null>(null);
  const isAuthenticatingRef = useRef(false);

  const isWrongNetwork = !!isConnected && chainId !== null && chainId !== REQUIRED_CHAIN_ID;
  const isConnecting = status === 'connecting' || status === 'reconnecting' || isSwitchingNetwork || isSigningMessage;

  const clearRegistrationState = useCallback(() => {
    setRegistrationRequired(false);
    setRegistrationWalletAddress(null);
    setRegistrationChainId(null);
    setRegistrationToken(null);
    setRegistrationReferralCode(null);
    setRegistrationError(null);
  }, []);

  const normalizeReferralCode = useCallback((referralCode?: string | null): string | undefined => {
    const normalized = referralCode?.trim().toUpperCase();
    return normalized ? normalized : undefined;
  }, []);

  const persistReferralCode = useCallback((referralCode?: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const normalized = normalizeReferralCode(referralCode);

    if (normalized) {
      window.localStorage.setItem(REFERRAL_STORAGE_KEY, normalized);
      return;
    }

    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  }, [normalizeReferralCode]);

  const getPersistedReferralCode = useCallback((): string | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return normalizeReferralCode(window.localStorage.getItem(REFERRAL_STORAGE_KEY));
  }, [normalizeReferralCode]);

  const getReferralCodeFromLocation = useCallback((): string | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    try {
      const url = new URL(window.location.href);

      const queryReferral = normalizeReferralCode(
        url.searchParams.get('referralCode') ?? url.searchParams.get('ref'),
      );

      if (queryReferral) {
        return queryReferral;
      }

      const pathMatch = url.pathname.match(/^\/ref\/([^/]+)/i);

      if (!pathMatch?.[1]) {
        return undefined;
      }

      return normalizeReferralCode(decodeURIComponent(pathMatch[1]));
    } catch {
      return undefined;
    }
  }, [normalizeReferralCode]);

  const formatBalance = (value: number): string => Number(value).toFixed(2);

  const fetchBalance = useCallback(async () => {
    if (!userId || !AuthService.getToken()) {
      console.log('⚠️ fetchBalance: No userId or token');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await WalletService.getMyBalance();

      let usdtBalance = '0';
      if (address && isConnected) {
        try {
          const result = await refetchUSDT();
          if (result.data) {
            usdtBalance = Number(Number(formatUnits(result.data as bigint, 18)).toFixed(2)).toString();
          }
        } catch (e) { console.warn('⚠️ USDT fetch failed:', e); }
      }

      const nativeBalance = nativeData?.value !== undefined
        ? Number(Number(formatUnits(nativeData.value, nativeData.decimals)).toFixed(6)).toString()
        : balance.native;

      setBalance({
        usdt: usdtBalance,
        native: nativeBalance,
        nativeSymbol: nativeData?.symbol || balance.nativeSymbol || 'BNB',
        tdx: formatBalance(response.availableBalance ?? 0),
        tdxAvailable: formatBalance(response.availableBalance ?? 0),
        tdxLocked: formatBalance(response.lockedBalance ?? 0),
        tdxTotal: formatBalance(response.totalBalance ?? 0),
        gameLocked: formatBalance(response.gameLocked ?? 0),
        tradingLocked: formatBalance(response.tradingLocked ?? 0),
        withdrawalLocked: formatBalance(response.withdrawalLocked ?? 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balance');
    } finally {
      setIsLoading(false);
    }
  }, [userId, nativeData, address, isConnected, refetchUSDT, balance.native]);

  const fetchTransactions = useCallback(async () => {
    if (!userId || !AuthService.getToken()) return;
    try {
      setTransactions(await WalletService.getTransactionHistory(userId));
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId || !AuthService.getToken()) return;
    await Promise.all([fetchBalance(), fetchTransactions()]);
  }, [userId, fetchBalance, fetchTransactions]);

  const updateBalance = useCallback((next: Partial<WalletBalance>) => {
    setBalance(prev => ({ ...prev, ...next }));
  }, []);

  const addTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => [tx, ...prev]);
  }, []);

  const openWallet = useCallback(() => { setAuthError(null); appKit.open(); }, []);
  const clearAuthError = useCallback(() => setAuthError(null), []);

  const clearLocalAuth = useCallback(() => {
    AuthService.clearSession();
    setAuthUser(null);
    setUserId('');
    isAuthenticatingRef.current = false;
    setIsAuthenticating(false);
    setBalance(INITIAL_BALANCE);
    setTransactions([]);
    setError(null);
    setAuthError(null);
  }, []);

  const logout = useCallback(async () => {
    AuthService.clearSession();
    setAuthUser(null);
    setUserId('');
    isAuthenticatingRef.current = false;
    setIsAuthenticating(false);
    setBalance(INITIAL_BALANCE);
    setTransactions([]);
    setError(null);
    setAuthError(null);
    clearRegistrationState();
    authAttemptRef.current = null;
    registrationWalletRef.current = null;
    try { await appKit.disconnect(); } catch (e) { console.error('Disconnect failed:', e); }
  }, [clearRegistrationState]);

  const disconnectWallet = useCallback(async () => logout(), [logout]);

  const switchToRequiredNetwork = useCallback(async () => {
    if (chainId === REQUIRED_CHAIN_ID) return;
    try {
      await switchChainAsync({ chainId: REQUIRED_CHAIN_ID });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to switch network');
      throw err;
    }
  }, [chainId, switchChainAsync]);

  const registerWallet = useCallback(async (referralCode?: string) => {
    if (!address || !isConnected) throw new Error('Wallet not connected');
    if (isWrongNetwork) throw new Error(`Please switch to ${REQUIRED_NETWORK_NAME}`);
    if (!registrationToken) throw new Error('Registration session missing');
    if (isRegistering) return;

    setIsRegistering(true);
    setRegistrationError(null);

    try {
      const effectiveReferralCode =
        normalizeReferralCode(referralCode) ??
        registrationReferralCode ??
        getPersistedReferralCode();

      const response = await AuthService.registerUser({
        walletAddress: registrationWalletAddress ?? address,
        chainId: registrationChainId ?? chainId ?? REQUIRED_CHAIN_ID,
        registrationToken,
        ...(effectiveReferralCode ? { referralCode: effectiveReferralCode } : {}),
      });

      if (!response?.accessToken || !response?.user) throw new Error('Invalid registration response');

      AuthService.saveToken(response.accessToken);
      AuthService.saveUser(response.user);

      setAuthUser(response.user);
      setUserId(response.user.id);
      registrationWalletRef.current = null;
      clearRegistrationState();
      setAuthError(null);
      persistReferralCode(undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setRegistrationError(msg);
      throw err;
    } finally {
      setIsRegistering(false);
    }
  }, [
    address,
    isConnected,
    isWrongNetwork,
    registrationToken,
    registrationWalletAddress,
    registrationChainId,
    chainId,
    isRegistering,
    registrationReferralCode,
    clearRegistrationState,
    getPersistedReferralCode,
    normalizeReferralCode,
    persistReferralCode,
  ]);

  const cancelRegistration = useCallback(() => {
    registrationWalletRef.current = null;
    clearRegistrationState();
    authAttemptRef.current = null;
    setAuthError(null);
  }, [clearRegistrationState]);

  const authenticateWallet = useCallback(async () => {
    if (!address || !isConnected) return;
    if (isWrongNetwork) {
      setAuthError((prev) => (prev === `Please switch to ${REQUIRED_NETWORK_NAME}` ? prev : `Please switch to ${REQUIRED_NETWORK_NAME}`));
      return;
    }
    if (isAuthenticatingRef.current) return;

    const normalizedAddress = address.toLowerCase();
    if (registrationWalletRef.current === normalizedAddress) {
      console.info('Registration pending, skipping auth');
      return;
    }
    if (authAttemptRef.current === normalizedAddress) return;
    authAttemptRef.current = normalizedAddress;

    const savedToken = AuthService.getToken();
    const savedUser = AuthService.getSavedUser();
    const hasSavedRole = savedUser?.role === 'admin' || savedUser?.role === 'user';

    if (savedToken && savedUser?.walletAddress?.toLowerCase() === normalizedAddress && hasSavedRole) {
      setAuthUser(savedUser);
      setUserId(savedUser.id);
      clearRegistrationState();
      setAuthError(null);
      return;
    }

    if (savedToken || savedUser) {
      const savedWallet = savedUser?.walletAddress?.toLowerCase();
      if (!savedWallet || savedWallet !== normalizedAddress || !savedToken || !hasSavedRole) {
        AuthService.clearSession();
        setAuthUser(null);
        setUserId('');
        setBalance(INITIAL_BALANCE);
        setTransactions([]);
        setError(null);
      }
    }

    isAuthenticatingRef.current = true;
    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const referralCode = getReferralCodeFromLocation() ?? getPersistedReferralCode();

      if (referralCode) {
        persistReferralCode(referralCode);
      }

      const nonce = await AuthService.getNonce(address);

      // Never allow the signature request to hang forever — otherwise the UI
      // stays stuck on "Verifying" with no way out. After 90s we surface an
      // error and the user can retry from the modal / wallet card.
      let signTimer: ReturnType<typeof setTimeout> | undefined;
      let signature: `0x${string}`;
      try {
        signature = await Promise.race([
          signMessageAsync({ message: nonce.message }),
          new Promise<`0x${string}`>((_, reject) => {
            signTimer = setTimeout(
              () => reject(new Error('Signature request timed out. Please try again.')),
              90000,
            );
          }),
        ]);
      } finally {
        if (signTimer) clearTimeout(signTimer);
      }

      const response = await AuthService.verifySignature({
        walletAddress: address,
        signature,
        nonce: nonce.nonce,
        chainId: chainId ?? REQUIRED_CHAIN_ID,
        ...(referralCode ? { referralCode } : {}),
      });

      if (response.registered === false) {
        const regAddress = response.walletAddress ?? address;
        registrationWalletRef.current = regAddress.toLowerCase();
        setRegistrationRequired(true);
        setRegistrationWalletAddress(regAddress);
        setRegistrationChainId(response.chainId ?? chainId ?? REQUIRED_CHAIN_ID);
        setRegistrationReferralCode(referralCode ?? getPersistedReferralCode() ?? null);
        if (!response.registrationToken) throw new Error('Registration token missing');
        setRegistrationToken(response.registrationToken);
        setRegistrationError(null);
        setAuthUser(null);
        setUserId('');
        setAuthError(null);
        return;
      }

      if (!response.accessToken || !response.user) throw new Error('Invalid auth response');

      AuthService.saveToken(response.accessToken);
      AuthService.saveUser(response.user);
      setAuthUser(response.user);
      setUserId(response.user.id);
      clearRegistrationState();
      setAuthError(null);
      persistReferralCode(undefined);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      isAuthenticatingRef.current = false;
      setIsAuthenticating(false);
      authAttemptRef.current = null;
    }
  }, [
    address,
    isConnected,
    isWrongNetwork,
    chainId,
    signMessageAsync,
    clearRegistrationState,
    getPersistedReferralCode,
    getReferralCodeFromLocation,
    persistReferralCode,
  ]);

  const retryAuth = useCallback(async () => {
    setAuthError(null);
    authAttemptRef.current = null;
    await authenticateWallet();
  }, [authenticateWallet]);

  useEffect(() => {
    const walletIsPendingConnection = status === 'connecting' || status === 'reconnecting';

    if (!isConnected) {
      authAttemptRef.current = null;
      registrationWalletRef.current = null;
      isAuthenticatingRef.current = false;

      if (walletIsPendingConnection) {
        return;
      }

      clearLocalAuth();
      clearRegistrationState();
      return;
    }

    if (!address) return;

    if (isWrongNetwork) {
      setAuthError((prev) => (prev === `Please switch to ${REQUIRED_NETWORK_NAME}` ? prev : `Please switch to ${REQUIRED_NETWORK_NAME}`));
      return;
    }

    if (registrationRequired && registrationWalletAddress?.toLowerCase() === address.toLowerCase()) return;
    void authenticateWallet();
  }, [status, isConnected, address, isWrongNetwork, registrationRequired, registrationWalletAddress, authenticateWallet, clearLocalAuth, clearRegistrationState]);

  useEffect(() => {
    if (!userId || !isConnected || isWrongNetwork || !AuthService.getToken()) return;
    void refresh();
  }, [userId, isConnected, isWrongNetwork, refresh]);

  const prevAddressRef = useRef<string | null>(null);
  useEffect(() => {
    const curr = address?.toLowerCase() ?? null;
    const prev = prevAddressRef.current;
    if (prev && curr && prev !== curr) {
      AuthService.clearSession();
      setAuthUser(null);
      setUserId('');
      isAuthenticatingRef.current = false;
      setIsAuthenticating(false);
      setBalance(INITIAL_BALANCE);
      setTransactions([]);
      setError(null);
      setAuthError(null);
      clearRegistrationState();
      authAttemptRef.current = null;
      registrationWalletRef.current = null;
    }
    prevAddressRef.current = curr;
  }, [address, clearRegistrationState]);

  const value = useMemo<WalletContextType>(() => ({
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
    isAdmin: authUser?.role === 'admin',
    isAuthenticated: !!authUser && !!AuthService.getToken(),
    isAuthenticating,
    authError,
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
  }), [
    address, isConnected, chainId, isWrongNetwork, isConnecting, openWallet, disconnectWallet,
    switchToRequiredNetwork, authUser, isAuthenticating, authError, authenticateWallet, retryAuth,
    clearAuthError, logout, registrationRequired, registrationWalletAddress, registrationChainId,
    registrationToken, registerWallet, cancelRegistration, isRegistering, registrationError,
    userId, balance, isLoading, error, refresh, fetchBalance, fetchTransactions, updateBalance,
    addTransaction, transactions,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export const useWalletContext = useWallet;