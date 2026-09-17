import type { Factor } from '@supabase/supabase-js';

import { apiClient } from '../../core/api/client';
import { supabase } from '../../lib/supabaseClient';
import { AuthService } from '../../auth/services/auth.service';

export type Aal = 'aal1' | 'aal2';

export interface AdminMfaFactorView {
  id: string;
  type: string;
  status: string;
  friendlyName: string | null;
  createdAt: string | null;
  lastChallengedAt: string | null;
}

export interface AdminMfaStatus {
  enrolled: boolean;
  verified: boolean;
  aal: Aal;
  supabaseLinked: boolean;
  lookupFailed: boolean;
  factors: AdminMfaFactorView[];
  pendingFactors: number;
  throttle: {
    blocked: boolean;
    failedAttempts: number;
    retryAfterSeconds: number;
    /** Backend fail-closed flag: throttle storage temporarily unavailable. */
    unavailable?: boolean;
  };
  /** true when the shared throttle storage could not be reached. */
  throttleUnavailable?: boolean;
}

/** MFA lifecycle events accepted by the backend. */
export type AdminMfaEvent =
  | 'ADMIN_MFA_ENROLL_STARTED'
  | 'ADMIN_MFA_ENROLL_SUCCESS'
  | 'ADMIN_MFA_VERIFY_SUCCESS'
  | 'ADMIN_MFA_VERIFY_FAILED'
  | 'ADMIN_MFA_CHANGED'
  | 'ADMIN_MFA_DISABLE';

export interface AdminMfaEnrollment {
  factorId: string;
  /** otpauth:// URI encoded in the QR — shown ONCE during enrollment only. */
  uri: string;
  /** Manual setup key — shown ONCE during enrollment only. */
  secret: string;
  /** SVG data-URI QR code produced by Supabase. */
  qrCode: string;
  friendlyName: string;
}

/** Human-readable TradeX label shown inside Google Authenticator. */
export const ADMIN_TOTP_ISSUER = 'TradeX Admin';

export function mfaErrorMessage(err: unknown, fallback: string): string {
  const e = err as {
    message?: string;
    code?: string;
    status?: number;
    response?: { data?: { code?: string; message?: string } };
  };
  const code = e?.code ?? e?.response?.data?.code;
  if (code === 'mfa_verification_failed' || code === 'invalid_code') {
    return 'That code is not valid. Check Google Authenticator and try again.';
  }
  if (code === 'insufficient_aal' || code === 'ADMIN_MFA_REQUIRED') {
    return 'Two-factor verification is required first.';
  }
  if (code === 'mfa_factor_name_conflict') {
    return 'An authenticator with that name already exists. Try again.';
  }
  if (code === 'ADMIN_MFA_THROTTLED' || e?.status === 429) {
    return 'Too many invalid codes. Please wait a few minutes and try again.';
  }
  const msg = e?.response?.data?.message ?? e?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

/**
 * Admin MFA (Supabase TOTP) + backend MFA status.
 *
 * The TOTP secret/QR is produced by Supabase Auth during enrollment and is
 * surfaced to the SIGNED-IN ADMIN only, once. It is never persisted in
 * localStorage, never sent to the TradeX backend, never logged, and is never
 * returned by any TradeX API after enrollment.
 */
export const AdminMfaService = {
  // ---------- backend (authoritative) ----------

  async getStatus(): Promise<AdminMfaStatus> {
    const { data } = await apiClient.get<{ success: boolean; data: AdminMfaStatus }>(
      '/admin/auth/mfa/status',
    );
    return data.data;
  },

  async recordEvent(payload: {
    event: AdminMfaEvent;
    factorId?: string;
    factorCount?: number;
    result?: string;
  }): Promise<void> {
    await apiClient.post('/admin/auth/mfa/events', payload);
  },

  // ---------- Supabase session / AAL ----------

  /** Current authenticator assurance level straight from Supabase. */
  async getAal(): Promise<Aal> {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return data?.currentLevel === 'aal2' ? 'aal2' : 'aal1';
    } catch {
      return 'aal1';
    }
  },

  /**
   * Copies the (possibly AAL2-upgraded) Supabase access token into the TradeX
   * API client so subsequent admin calls carry the verified token.
   * No custom JWT is created — this is the same Supabase token.
   */
  async syncAccessToken(): Promise<void> {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) AuthService.saveToken(token);
    } catch {
      // Non-fatal: the existing token remains in place.
    }
  },

  /** Verified TOTP factors for the current Supabase user. */
  async listVerifiedTotpFactors(): Promise<Factor[]> {
    const all = await AdminMfaService.listAllTotpFactors();
    return all.filter((f) => f.status === 'verified');
  },

  async listAllTotpFactors(): Promise<Factor[]> {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error || !data) return [];
      return data.totp ?? [];
    } catch {
      return [];
    }
  },

  // ---------- enrollment ----------

  /**
   * Starts TOTP enrollment: creates an UNVERIFIED Supabase factor and returns
   * the QR + manual key for the admin to scan. Any existing factor is left
   * intact until the new one is verified — this prevents lockout.
   */
  async startEnrollment(currentFactorCount: number): Promise<AdminMfaEnrollment> {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `${ADMIN_TOTP_ISSUER} ${currentFactorCount + 1}`,
      });

      if (error || !data || !data.totp) {
        throw error ?? new Error('Enrollment failed');
      }

      await AdminMfaService.recordEvent({
        event: 'ADMIN_MFA_ENROLL_STARTED',
        factorId: data.id,
        factorCount: currentFactorCount + 1,
      }).catch(() => undefined);

      return {
        factorId: data.id,
        uri: data.totp.uri,
        secret: data.totp.secret,
        qrCode: data.totp.qr_code,
        friendlyName: data.friendly_name ?? ADMIN_TOTP_ISSUER,
      };
    } catch (err) {
      throw new Error(mfaErrorMessage(err, 'Could not start authenticator setup.'));
    }
  },

  /**
   * Verifies a 6-digit code against a factor (challenge + verify).
   * On success Supabase upgrades THIS session to AAL2 and rotates the token.
   * A failure NEVER grants AAL2 and never deletes anything.
   */
  async verifyCode(
    factorId: string,
    code: string,
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) {
        throw challenge.error ?? new Error('Challenge failed');
      }

      const { data, error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      });

      if (error || !data) {
        throw error ?? new Error('Verification failed');
      }

      await AdminMfaService.syncAccessToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: mfaErrorMessage(err, 'Verification failed.') };
    }
  },

  /** Removes a factor. Requires an AAL2 session (enforced by Supabase). */
  async unenrollFactor(factorId: string): Promise<boolean> {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      return !error;
    } catch {
      return false;
    }
  },

  /** Uses the existing Supabase sign-out — no custom session handling. */
  async signOut(): Promise<void> {
    await supabase.auth.signOut().catch(() => undefined);
  },

  getErrorMessage: mfaErrorMessage,
};
