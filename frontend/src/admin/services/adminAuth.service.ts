import { apiClient } from '../../core/api/client';

/** UX-only routing hint. The backend re-enforces role + AAL2 on every call. */
export type AdminNextStep = 'ADMIN_DASHBOARD' | 'MFA_SETUP' | 'MFA_VERIFY';

export interface AdminVerifyData {
  admin: true;
  userId: string;
  email: string | null;
  mobileNumber: string | null;
  /** Assurance level of THIS session, from the VERIFIED Supabase JWT. */
  aal: 'aal1' | 'aal2';
  mfaVerified: boolean;
  nextStep: AdminNextStep;
  mfa: {
    enrolled: boolean;
    verified: boolean;
    aal: 'aal1' | 'aal2';
    supabaseLinked: boolean;
    lookupFailed: boolean;
    factors: Array<{
      id: string;
      type: string;
      status: string;
      friendlyName: string | null;
      createdAt: string | null;
      lastChallengedAt: string | null;
    }>;
    pendingFactors: number;
    throttle: {
      blocked: boolean;
      failedAttempts: number;
      retryAfterSeconds: number;
    };
  };
}

export interface AdminVerifyResponse {
  success: boolean;
  data: AdminVerifyData;
}

/**
 * Backend-authoritative admin verification (role + MFA/AAL2 state).
 * Called after Supabase login; the backend re-resolves users.role from the DB
 * and reads the AAL claim from the VERIFIED token.
 * Frontend isAdmin/MFA state is UX-only — every admin API call is still gated
 * by JwtAuthGuard + AdminGuard server-side.
 */
export async function verifyAdminAccess(): Promise<AdminVerifyResponse> {
  const { data } = await apiClient.get<AdminVerifyResponse>('/admin/auth/verify');
  return data;
}
