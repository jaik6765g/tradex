// ============================================================
// TRADEX AUTH HOOK
// ============================================================
//
// Flow:
//
// Wallet connected
//      ↓
// get nonce
//      ↓
// sign authentication message
//      ↓
// verify signature
//      ↓
// backend creates/finds user
//      ↓
// JWT
//      ↓
// save session
//
// Referral code is only sent during authentication.
// Backend decides whether it is a new registration
// or an existing login.
// ============================================================

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  useAccount,
  useSignMessage,
} from 'wagmi';

import {
  AuthService,
} from '../services/auth.service';

import type {
  AuthState,
} from './auth.types';

import { CHAIN_IDS } from '../../wallet/config/networks';

// ============================================================
// DEFAULT STATE
// ============================================================

const INITIAL_STATE: AuthState = {
  isAuthenticated: false,
  isAuthenticating: false,
  user: null,
  wallet: null,
  error: null,
};

// ============================================================
// ERROR NORMALIZER
// ============================================================

function getErrorMessage(
  error: unknown,
): string {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error
  ) {
    const response = (
      error as {
        response?: {
          data?: {
            message?: string | string[];
          };
        };
      }
    ).response;

    const message =
      response?.data?.message;

    if (Array.isArray(message)) {
      return message.join(', ');
    }

    if (typeof message === 'string') {
      return message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Authentication failed';
}

// ============================================================
// REFERRAL CODE
// ============================================================
//
// Supports:
//
// /ref/TDX7719677
//
// /?ref=TDX7719677
//
// /register?ref=TDX7719677
//
// Does not send anything if no referral exists.
// ============================================================

function getReferralCode(): string | undefined {
  const pathname =
    window.location.pathname;

  const searchParams =
    new URLSearchParams(
      window.location.search,
    );

  // ----------------------------------------------------------
  // Query parameter
  // ----------------------------------------------------------

  const queryReferral =
    searchParams.get('ref');

  if (queryReferral) {
    return queryReferral
      .trim()
      .toUpperCase();
  }

  // ----------------------------------------------------------
  // /ref/CODE
  // ----------------------------------------------------------

  const segments =
    pathname
      .split('/')
      .filter(Boolean);

  const refIndex =
    segments.findIndex(
      (segment) =>
        segment.toLowerCase() ===
        'ref',
    );

  if (
    refIndex !== -1 &&
    segments[refIndex + 1]
  ) {
    return segments[
      refIndex + 1
    ]
      .trim()
      .toUpperCase();
  }

  return undefined;
}

// ============================================================
// HOOK
// ============================================================

export function useAuth() {
  const {
    address,
    isConnected,
    chainId,
  } = useAccount();

  const {
    signMessageAsync,
  } = useSignMessage();

  const [
    state,
    setState,
  ] = useState<AuthState>(
    INITIAL_STATE,
  );

  // ==========================================================
  // RESTORE EXISTING SESSION
  // ==========================================================

  useEffect(() => {
    const token =
      AuthService.getToken();

    const savedUser =
      AuthService.getSavedUser();

    if (
      token &&
      savedUser
    ) {
      setState({
        isAuthenticated: true,
        isAuthenticating: false,
        user: savedUser,
        wallet: null,
        error: null,
      });
    }
  }, []);

  // ==========================================================
  // AUTHENTICATE WALLET
  // ==========================================================

  const authenticate =
    useCallback(async () => {
      // --------------------------------------------------------
      // Wallet must be connected
      // --------------------------------------------------------

      if (
        !isConnected ||
        !address
      ) {
        throw new Error(
          'Please connect your wallet first',
        );
      }

      // --------------------------------------------------------
      // Chain must exist
      // --------------------------------------------------------

      if (!chainId) {
        throw new Error(
          'Unable to determine wallet network',
        );
      }

      // --------------------------------------------------------
         // TradeX production runs only on BSC Mainnet      // --------------------------------------------------------

      const isSupportedChain =
        chainId ===
          CHAIN_IDS.BSC_MAINNET;

      if (!isSupportedChain) {
        throw new Error(
          'Please switch to a supported TradeX network',
        );
      }

      setState(
        (previous) => ({
          ...previous,
          isAuthenticating: true,
          error: null,
        }),
      );

      try {
        // ======================================================
        // 1. GET NONCE
        // ======================================================

        const nonceResponse =
          await AuthService.getNonce(
            address,
          );

        // ======================================================
        // 2. SIGN AUTH MESSAGE
        // ======================================================

        const signature =
          await signMessageAsync({
            message:
              nonceResponse.message,
          });

        // ======================================================
        // 3. GET REFERRAL
        // ======================================================

        const referralCode =
          getReferralCode();

        // ======================================================
        // 4. VERIFY WITH BACKEND
        // ======================================================

        const response =
          await AuthService.verifySignature(
            {
              walletAddress:
                address,

              signature,

              nonce:
                nonceResponse.nonce,

              chainId,

              ...(referralCode
                ? {
                    referralCode,
                  }
                : {}),
            },
          );

        // ======================================================
        // 5. SAVE JWT
        // ======================================================

        AuthService.saveToken(
          response.accessToken,
        );

        // ======================================================
        // 6. SAVE USER
        // ======================================================

        AuthService.saveUser(
          response.user,
        );

        // ======================================================
        // 7. UPDATE STATE
        // ======================================================

        setState({
          isAuthenticated: true,

          isAuthenticating: false,

          user:
            response.user,

          wallet:
            response.wallet,

          error: null,
        });

        return response;
      } catch (error) {
        const message =
          getErrorMessage(error);

        setState(
          (previous) => ({
            ...previous,

            isAuthenticating: false,

            error: message,
          }),
        );

        throw error;
      }
    }, [
      address,
      isConnected,
      chainId,
      signMessageAsync,
    ]);

  // ==========================================================
  // LOGOUT
  // ==========================================================

  const logout =
    useCallback(() => {
      AuthService.clearSession();

      setState({
        ...INITIAL_STATE,
      });
    }, []);

  // ==========================================================
  // CLEAR ERROR
  // ==========================================================

  const clearError =
    useCallback(() => {
      setState(
        (previous) => ({
          ...previous,
          error: null,
        }),
      );
    }, []);

  // ==========================================================
  // RESET AUTH WHEN WALLET CHANGES
  // ==========================================================

  useEffect(() => {
    if (!isConnected || !address) {
      return;
    }

    const savedUser =
      AuthService.getSavedUser();

    // Different wallet connected.
    if (
      savedUser &&
      savedUser.walletAddress.toLowerCase() !==
        address.toLowerCase()
    ) {
      AuthService.clearSession();

      setState({
        ...INITIAL_STATE,
      });
    }
  }, [
    address,
    isConnected,
  ]);

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    ...state,

    authenticate,

    logout,

    clearError,
  };
}