// frontend/src/admin/context/AdminSecurityContext.tsx

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAppAuth } from '../../auth/authContext';
import {
  verifyAdminAccess,
  type AdminNextStep,
  type AdminVerifyData,
} from '../services/adminAuth.service';
import type { AdminMfaStatus } from '../services/adminMfa.service';

/**
 * Backend-verified admin security stage.
 *
 * UX ROUTING ONLY. Every admin API call is independently gated by
 * JwtAuthGuard + AdminGuard (+ the AAL2 MFA layer) on the server, so forging
 * this state in the browser can never grant access to admin data.
 */
export type AdminSecurityStage =
  | 'UNKNOWN'
  | 'NOT_ADMIN'
  | 'MFA_SETUP'
  | 'MFA_VERIFY'
  | 'READY';

interface AdminSecurityContextValue {
  /** A backend verification is in flight. */
  loading: boolean;
  stage: AdminSecurityStage;
  /** Backend verification payload (null until verified). */
  data: AdminVerifyData | null;
  /** Backend-authoritative, secret-free MFA status. */
  mfa: AdminMfaStatus | null;
  error: string | null;
  /** Re-runs backend verification (call after MFA verify/change/disable). */
  refresh: () => Promise<AdminVerifyData | null>;
}

const AdminSecurityContext = createContext<AdminSecurityContextValue | undefined>(
  undefined,
);

function stageFromNextStep(nextStep: AdminNextStep): AdminSecurityStage {
  if (nextStep === 'MFA_SETUP') return 'MFA_SETUP';
  if (nextStep === 'MFA_VERIFY') return 'MFA_VERIFY';
  return 'READY';
}

function statusOf(err: unknown): number | null {
  const candidate = err as { response?: { status?: number }; status?: number };
  return candidate?.response?.status ?? candidate?.status ?? null;
}

/**
 * Resolves the backend-verified admin state once per authenticated session and
 * exposes it to the admin routing gates. Never stores tokens, codes or secrets —
 * the Supabase session already lives where the existing architecture put it.
 */
export function AdminSecurityProvider({
  children,
}: {
  children: React.ReactElement;
}) {
  const { isAuthenticated, isAuthenticating } = useAppAuth();
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<AdminSecurityStage>('UNKNOWN');
  const [data, setData] = useState<AdminVerifyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<AdminVerifyData | null> | null>(null);

  const refresh = useCallback(async (): Promise<AdminVerifyData | null> => {
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await verifyAdminAccess();
        setData(response.data);
        setStage(stageFromNextStep(response.data.nextStep));
        return response.data;
      } catch (err) {
        const status = statusOf(err);
        setData(null);
        setStage('NOT_ADMIN');
        setError(
          status === 401
            ? 'Your session has expired. Please sign in again.'
            : 'Admin access denied. This account is not an authorized admin.',
        );
        return null;
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (isAuthenticating) return;

    if (!isAuthenticated) {
      setData(null);
      setStage('UNKNOWN');
      setError(null);
      return;
    }

    void refresh();
  }, [isAuthenticated, isAuthenticating, refresh]);

  const value = useMemo<AdminSecurityContextValue>(
    () => ({
      loading,
      stage,
      data,
      mfa: data?.mfa ?? null,
      error,
      refresh,
    }),
    [data, error, loading, refresh, stage],
  );

  return (
    <AdminSecurityContext.Provider value={value}>
      {children}
    </AdminSecurityContext.Provider>
  );
}

export function useAdminSecurity(): AdminSecurityContextValue {
  const ctx = useContext(AdminSecurityContext);
  if (!ctx) {
    throw new Error('useAdminSecurity must be used within AdminSecurityProvider');
  }
  return ctx;
}
