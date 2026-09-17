import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AdminAccessPolicy } from './admin-access.policy';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { AdminMfaService, type AdminMfaStatus } from './admin-mfa.service';
import { User } from '../users/user.entity';

/**
 * What the frontend should do next after backend verification.
 * UX ONLY — every admin API independently re-enforces role + AAL2.
 */
export type AdminNextStep = 'ADMIN_DASHBOARD' | 'MFA_SETUP' | 'MFA_VERIFY';

export interface AdminVerifyResult {
  admin: true;
  userId: string;
  email: string | null;
  mobileNumber: string | null;
  /** Authenticator assurance level of THIS session (from the verified JWT). */
  aal: 'aal1' | 'aal2';
  /** True only when the session is AAL2 and a verified TOTP factor exists. */
  mfaVerified: boolean;
  nextStep: AdminNextStep;
  mfa: AdminMfaStatus;
}

/**
 * Backend-authoritative admin verification for the frontend admin gate.
 * Called AFTER Supabase login with the Supabase access token in the
 * Authorization header (JwtAuthGuard already resolved req.user).
 * Re-reads users.role + users.status from the DB — the frontend `isAdmin`
 * flag is UX-only and never trusted here. Records a no-secret audit event.
 *
 * MFA/AAL2 is authoritative from the verified Supabase JWT `aal` claim, not
 * from any frontend flag.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(AdminAuditLog)
    private readonly auditRepo: Repository<AdminAuditLog>,
    private readonly policy: AdminAccessPolicy,
    private readonly mfa: AdminMfaService,
  ) {}

  async verify(
    userId: string,
    reqMeta: { ip: string | null; ua: string | null },
    session: { authUserId?: string; aal?: 'aal1' | 'aal2' },
  ): Promise<AdminVerifyResult> {
    const user = await this.policy.loadUser(userId);
    const decision = this.policy.decide(user);
    if (!decision.allowed || !user) {
      await this.audit(null, 'ADMIN_VERIFY_DENIED', { userId, reason: decision.reason }, reqMeta);
      const err = new Error('Admin access denied') as Error & { status?: number };
      err.status = decision.reason === 'UNKNOWN_ACCOUNT' ? 401 : 403;
      throw err;
    }

    const mfaStatus = await this.mfa.getStatus(userId, session.authUserId, session.aal);
    const nextStep = this.resolveNextStep(mfaStatus);

    await this.audit(
      user.id,
      'ADMIN_VERIFY_SUCCESS',
      { userId: user.id, aal: mfaStatus.aal, mfaEnrolled: mfaStatus.enrolled, nextStep },
      reqMeta,
    );

    return {
      admin: true,
      userId: user.id,
      email: user.email,
      mobileNumber: user.mobileNumber,
      aal: mfaStatus.aal,
      mfaVerified: mfaStatus.verified,
      nextStep,
      mfa: mfaStatus,
    };
  }

  /**
   * AAL2 is the authoritative access signal: once Supabase has verified a TOTP
   * factor for this session, the admin may proceed. For AAL1 sessions we route
   * to setup/verify. When the Supabase factor lookup itself failed we never
   * optimistically send the admin to the dashboard — we route to verify.
   */
  private resolveNextStep(status: AdminMfaStatus): AdminNextStep {
    if (status.aal === 'aal2') return 'ADMIN_DASHBOARD';
    if (status.lookupFailed) return 'MFA_VERIFY';
    return status.enrolled ? 'MFA_VERIFY' : 'MFA_SETUP';
  }


  private async audit(
    adminId: string | null,
    action: string,
    metadata: Record<string, unknown>,
    reqMeta: { ip: string | null; ua: string | null },
  ): Promise<void> {
    try {
      const row = this.auditRepo.create({
        adminId: adminId ?? '00000000-0000-0000-0000-000000000000',
        action,
        targetType: 'admin_auth',
        targetId: null,
        oldValue: null,
        newValue: null,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.ua,
        metadata,
      });
      await this.auditRepo.save(row);
    } catch {
      // audit never breaks auth
    }
  }
}
