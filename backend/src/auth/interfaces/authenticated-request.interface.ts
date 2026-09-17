import { Request } from 'express';

/**
 * Supabase authenticator assurance level, taken from the VERIFIED access
 * token (`aal` claim). Values other than `aal2` are normalised to `aal1`.
 */
export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    authUserId?: string;
    mobileNumber?: string | null;
    email?: string;
    walletAddress?: string;
    role?: string;
    status?: string;
    /** Set by SupabaseJwtStrategy from the verified token payload. */
    aal?: AuthenticatorAssuranceLevel;
    /** Authentication method references from the verified token payload. */
    amr?: Array<{ method: string; timestamp: number }>;
  };
}
