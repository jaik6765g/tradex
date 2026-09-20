import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { supabase } from '../lib/supabaseClient';
import { warmUpBackend } from '../core/api/client';
import {
  AuthService,
  type AuthSession,
  type LinkWalletPayload,
} from './services/auth.service';
import { isAuthRejectedError } from './services/auth-resilience';
import type { AuthUser, AuthWallet } from './hooks/auth.types';

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  userId: string;
  isAdmin: boolean;
  authError: string | null;
  login: (mobileNumber: string, password: string) => Promise<void>;
  signup: (
    mobileNumber: string,
    email: string,
    password: string,
    referralCode?: string,
  ) => Promise<void>;
  forgotPassword: (mobileNumber: string) => Promise<void>;
  resetPassword: (
    mobileNumber: string,
    token: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  linkWallet: (payload: LinkWalletPayload) => Promise<AuthWallet>;
  claimWallet: (payload: LinkWalletPayload) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeMobile(raw: string): string {
  const trimmed = raw.trim().replace(/[\s-]/g, '');

  if (!trimmed) {
    throw new Error('Mobile number is required');
  }

  const normalized = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;

  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
    throw new Error('Invalid mobile number');
  }

  return normalized;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncUser = useCallback((u: AuthUser) => {
    setUser(u);
    AuthService.saveUser(u);
  }, []);

  const refresh = useCallback(async () => {
    if (!AuthService.getToken()) {
      setUser(null);
      return;
    }

    try {
      syncUser(await AuthService.fetchMe());
    } catch (err) {
      // Cold-start resilience: a network timeout / 5xx while the backend is
      // waking up must NOT log the user out. Only a CONFIRMED auth rejection
      // (401/403) drops the in-memory user; stored-session clearing is
      // handled by the API client's confirmation flow.
      if (isAuthRejectedError(err)) {
        setUser(null);
      }
    }
  }, [syncUser]);

  const applySession = useCallback(
    async (session: AuthSession) => {
      if (!session.access_token) {
        AuthService.clearSession();
        setUser(null);
        return;
      }

      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? '',
      });
      AuthService.saveToken(session.access_token);
      syncUser(session.user);
    },
    [syncUser],
  );

  useEffect(() => {
    let active = true;

    // Best-effort, non-blocking: start a sleeping backend booting while the
    // UI renders. Never awaited and never affects the auth flow.
    warmUpBackend();

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          AuthService.saveToken(data.session.access_token);
        } else {
          AuthService.clearSession();
        }
        await refresh();
      } finally {
        if (active) {
          setIsAuthenticating(false);
        }
      }
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session) {
          AuthService.saveToken(session.access_token);
          await refresh();
        } else {
          AuthService.clearSession();
          setUser(null);
        }
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [refresh]);

  const login = useCallback(
    async (mobileNumber: string, password: string) => {
      setAuthError(null);
      try {
        const session = await AuthService.login({
          mobileNumber: normalizeMobile(mobileNumber),
          password,
        });
        await applySession(session);
      } catch (err) {
        throw new Error(AuthService.getErrorMessage(err));
      }
    },
    [applySession],
  );

  const signup = useCallback(
    async (
      mobileNumber: string,
      email: string,
      password: string,
      referralCode?: string,
    ) => {
      setAuthError(null);
      try {
        // A NEW signup must never reuse a prior session. Clear any existing
        // Supabase session and local auth state before creating the account.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        AuthService.clearSession();
        setUser(null);

        const session = await AuthService.signup({
          mobileNumber: normalizeMobile(mobileNumber),
          email,
          password,
          referralCode,
        });

        if (!session.access_token) {
          // Fall back to a client-side sign-in (anon key) to guarantee a session.
          const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });

          if (error || !data.session) {
            AuthService.clearSession();
            setUser(null);
            throw new Error('Account created. Please log in.');
          }

          AuthService.saveToken(data.session.access_token);
          syncUser(session.user);
          return;
        }

        await applySession(session);
      } catch (err) {
        throw new Error(AuthService.getErrorMessage(err));
      }
    },
    [applySession, syncUser],
  );

  const forgotPassword = useCallback(async (mobileNumber: string) => {
    setAuthError(null);
    try {
      await AuthService.forgotPassword(normalizeMobile(mobileNumber));
    } catch (err) {
      throw new Error(AuthService.getErrorMessage(err));
    }
  }, []);

  const resetPassword = useCallback(
    async (mobileNumber: string, token: string, password: string) => {
      setAuthError(null);
      try {
        await AuthService.resetPassword({
          mobileNumber: normalizeMobile(mobileNumber),
          token,
          password,
        });
      } catch (err) {
        throw new Error(AuthService.getErrorMessage(err));
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut().catch(() => undefined);
    AuthService.clearSession();
    setUser(null);
  }, []);
  const linkWallet = useCallback(
    async (payload: LinkWalletPayload) => {
      const wallet = await AuthService.linkWallet(payload);
      await refresh();
      return wallet;
    },
    [refresh],
  );

  const claimWallet = useCallback(
    async (payload: LinkWalletPayload) => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        throw new Error('Login with your mobile number first');
      }

      syncUser(await AuthService.claimWallet({ ...payload, accessToken }));
    },
    [syncUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAuthenticating,
      userId: user?.id ?? '',
      isAdmin: user?.role === 'admin',
      authError,
      login,
      signup,
      forgotPassword,
      resetPassword,
      logout,
      linkWallet,
      claimWallet,
      refresh,
    }),
    [
      user,
      isAuthenticating,
      authError,
      login,
      signup,
      forgotPassword,
      resetPassword,
      logout,
      linkWallet,
      claimWallet,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAppAuth must be used within AuthProvider');
  }

  return ctx;
}
