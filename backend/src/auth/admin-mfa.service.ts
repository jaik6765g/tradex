import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ADMIN_CLIENT } from '../supabase/supabase.module';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { AdminMfaThrottleService, type AdminMfaThrottleState } from './admin-mfa-throttle.service';

/**
 * Audit events a signed-in admin may record about their own MFA lifecycle.
 * `ADMIN_MFA_RECOVERY` is deliberately NOT here — it is operator-only and is
 * written by the out-of-band recovery command, never through a public API.
 */
export const ADMIN_MFA_CLIENT_EVENTS = [
  'ADMIN_MFA_ENROLL_STARTED',
  'ADMIN_MFA_ENROLL_SUCCESS',
  'ADMIN_MFA_VERIFY_SUCCESS',
  'ADMIN_MFA_VERIFY_FAILED',
  'ADMIN_MFA_CHANGED',
  'ADMIN_MFA_DISABLE',
] as const;

export type AdminMfaClientEvent = (typeof ADMIN_MFA_CLIENT_EVENTS)[number];

/** Events that may only be recorded from an AAL2 (verified) session. */
const AAL2_REQUIRED_EVENTS: readonly AdminMfaClientEvent[] = [
  'ADMIN_MFA_CHANGED',
  'ADMIN_MFA_DISABLE',
];

export interface AdminMfaFactorView {
  /** Supabase factor id (opaque identifier — never a secret). */
  id: string;
  type: string;
  status: string;
  friendlyName: string | null;
  createdAt: string | null;
  lastChallengedAt: string | null;
}

export interface AdminMfaStatus {
  /** At least one VERIFIED TOTP factor exists in Supabase Auth. */
  enrolled: boolean;
  /** The current session reached Supabase AAL2 (TOTP verified this session). */
  verified: boolean;
  aal: 'aal1' | 'aal2';
  /** false when the TradeX user has no linked Supabase identity. */
  supabaseLinked: boolean;
  /** true when the Supabase factor lookup failed (status unknown). */
  lookupFailed: boolean;
  factors: AdminMfaFactorView[];
  pendingFactors: number;
  throttle: AdminMfaThrottleState;
  /**
   * true when the shared throttle storage (Redis) could not be reached.
   * The throttle then fails CLOSED: verification paths return 503
   * ADMIN_MFA_SECURITY_UNAVAILABLE instead of allowing uncounted attempts.
   */
  throttleUnavailable: boolean;
}

export interface AdminMfaRequestMeta {
  ip: string | null;
  ua: string | null;
}

/**
 * Admin TOTP MFA status + audit.
 *
 * Supabase Auth owns the TOTP secret and the factor lifecycle; this service
 * never generates, stores or returns a TOTP secret, QR secret, recovery code,
 * password or token. It only reads SAFE factor metadata through the
 * service-role Supabase admin client.
 */
@Injectable()
export class AdminMfaService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly supabase: SupabaseClient,
    @InjectRepository(AdminAuditLog)
    private readonly auditRepo: Repository<AdminAuditLog>,
    private readonly throttle: AdminMfaThrottleService,
  ) {}

  /** Safe MFA status for the current admin session. */
  async getStatus(
    userId: string,
    authUserId: string | undefined | null,
    aal: 'aal1' | 'aal2' | undefined,
  ): Promise<AdminMfaStatus> {
    const level: 'aal1' | 'aal2' = aal === 'aal2' ? 'aal2' : 'aal1';
    // Fail-closed read: when Redis is unreachable the admin sees a blocked
    // (temporarily unavailable) throttle instead of an uncounted green light.
    let throttleState: AdminMfaThrottleState;
    let throttleUnavailable = false;
    try {
      throttleState = await this.throttle.snapshot(userId);
    } catch {
      throttleUnavailable = true;
      throttleState = {
        blocked: true,
        failedAttempts: 0,
        retryAfterSeconds: 0,
        unavailable: true,
      };
    }

    if (!authUserId) {
      return {
        enrolled: false,
        verified: false,
        aal: level,
        supabaseLinked: false,
        lookupFailed: false,
        factors: [],
        pendingFactors: 0,
        throttle: throttleState,
        throttleUnavailable,
      };
    }

    const factors = await this.listTotpFactors(authUserId);
    const safeFactors = factors ?? [];
    const verifiedFactors = safeFactors.filter(
      (factor) => factor.status === 'verified',
    );

    return {
      enrolled: verifiedFactors.length > 0,
      verified: level === 'aal2' && verifiedFactors.length > 0,
      aal: level,
      supabaseLinked: true,
      lookupFailed: factors === null,
      factors: safeFactors,
      pendingFactors: safeFactors.filter(
        (factor) => factor.status !== 'verified',
      ).length,
      throttle: throttleState,
      throttleUnavailable,
    };
  }

  /**
   * Records an allow-listed MFA lifecycle audit event for the CALLER.
   * The caller id always comes from the verified JWT, never the request body,
   * so an admin cannot forge another account's audit trail.
   */
  async recordEvent(params: {
    userId: string;
    aal: 'aal1' | 'aal2' | undefined;
    event: AdminMfaClientEvent;
    factorId?: string;
    factorCount?: number;
    result?: string;
    meta: AdminMfaRequestMeta;
  }): Promise<{
    recorded: true;
    throttle: AdminMfaThrottleState;
  }> {
    const { userId, event, factorId, factorCount, result, meta } = params;
    const aal: 'aal1' | 'aal2' = params.aal === 'aal2' ? 'aal2' : 'aal1';

    if (!ADMIN_MFA_CLIENT_EVENTS.includes(event)) {
      throw new HttpException('Unsupported MFA event', HttpStatus.BAD_REQUEST);
    }

    if (AAL2_REQUIRED_EVENTS.includes(event) && aal !== 'aal2') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'ADMIN_MFA_REQUIRED',
        message: 'Admin MFA required',
        aal,
      });
    }

    await this.audit(userId, event, meta, {
      event,
      aal,
      factorId: factorId ?? null,
      factorCount: factorCount ?? null,
      result: result ?? null,
      // NOTE: never the submitted TOTP code, secret, token or password.
    });

    if (event === 'ADMIN_MFA_VERIFY_SUCCESS') {
      // Fail-closed: a successful verification may not be acknowledged while
      // the shared throttle state cannot be reset (otherwise the counter
      // would keep counting an admin who legitimately verified).
      try {
        await this.throttle.registerSuccess(userId);
      } catch {
        throw this.securityUnavailable();
      }

      return { recorded: true, throttle: await this.readThrottleState(userId) };
    }

    if (event === 'ADMIN_MFA_VERIFY_FAILED') {
      // Fail-closed: if the attempt cannot be counted in shared Redis state,
      // refuse the flow with 503 instead of allowing uncounted attempts.
      let state: AdminMfaThrottleState;
      try {
        state = await this.throttle.registerFailure(userId);
      } catch {
        throw this.securityUnavailable();
      }

      if (state.blocked) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            code: 'ADMIN_MFA_THROTTLED',
            message: 'Too many invalid verification codes. Try again later.',
            retryAfterSeconds: state.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return { recorded: true, throttle: state };
    }

    return { recorded: true, throttle: await this.readThrottleState(userId) };
  }

  /**
   * Safe temporary security error used when the shared throttle storage
   * (Redis) is unavailable. Never exposes Redis internals to the client.
   */
  private securityUnavailable(): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: 'ADMIN_MFA_SECURITY_UNAVAILABLE',
        message:
          'Security throttling is temporarily unavailable. Try again shortly.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** Throttle read for display metadata; degrades fail-closed on errors. */
  private async readThrottleState(
    userId: string,
  ): Promise<AdminMfaThrottleState> {
    try {
      return await this.throttle.snapshot(userId);
    } catch {
      return {
        blocked: true,
        failedAttempts: 0,
        retryAfterSeconds: 0,
        unavailable: true,
      };
    }
  }

  /** TOTP factor metadata, or null when the lookup failed. */
  private async listTotpFactors(
    authUserId: string,
  ): Promise<AdminMfaFactorView[] | null> {
    try {
      const { data, error } = await this.supabase.auth.admin.mfa.listFactors({
        userId: authUserId,
      });

      if (error || !data) {
        return null;
      }

      return (data.factors ?? [])
        .filter((factor) => factor.factor_type === 'totp')
        .map((factor) => ({
          id: factor.id,
          type: factor.factor_type,
          status: factor.status,
          friendlyName: factor.friendly_name ?? null,
          createdAt: factor.created_at ?? null,
          lastChallengedAt: factor.last_challenged_at ?? null,
        }));
    } catch {
      return null;
    }
  }

  private async audit(
    adminId: string,
    action: string,
    meta: AdminMfaRequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const row = this.auditRepo.create({
        adminId,
        action,
        targetType: 'admin_mfa',
        targetId: null,
        oldValue: null,
        newValue: null,
        ipAddress: meta.ip,
        userAgent: meta.ua,
        metadata,
      });

      await this.auditRepo.save(row);
    } catch {
      // Audit must never break the auth flow.
    }
  }
}
