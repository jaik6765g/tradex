import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/user.entity';

export interface AdminDecision {
  allowed: boolean;
  reason:
    | 'ACTIVE_ADMIN'
    | 'LEGACY_ADMIN_WALLET'
    | 'UNAUTHENTICATED'
    | 'UNKNOWN_ACCOUNT'
    | 'NOT_ADMIN'
    | 'INACTIVE';
}

/** MFA (Supabase AAL2) decision layered ON TOP of the role decision. */
export interface AdminMfaDecision {
  allowed: boolean;
  reason: 'AAL2_SATISFIED' | 'MFA_REQUIRED';
  aal: 'aal1' | 'aal2';
}

/**
 * Machine-readable code returned to the frontend when an active admin has a
 * valid AAL1 session but has not completed TOTP verification for this session.
 * The frontend uses it purely for routing — the backend remains authoritative.
 */
export const ADMIN_MFA_REQUIRED_CODE = 'ADMIN_MFA_REQUIRED';

/**
 * Single shared admin-authorization decision point.
 * Both AdminGuard and AdminAuthService delegate here so role semantics
 * (role='admin' + status='active', legacy ADMIN_WALLET fallback) can never
 * drift between the route guard and the verify endpoint.
 *
 * Pure decision function — no logging (never logs tokens/secrets).
 */
@Injectable()
export class AdminAccessPolicy {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async loadUser(userId: string): Promise<User | null> {
    if (!userId) return null;
    return this.userRepo.findOne({ where: { id: userId } });
  }

  decide(user: User | null): AdminDecision {
    if (!user) return { allowed: false, reason: 'UNKNOWN_ACCOUNT' };
    if ((user.status ?? '').toLowerCase() !== 'active') {
      return { allowed: false, reason: 'INACTIVE' };
    }
    if (user.role === 'admin') {
      return { allowed: true, reason: 'ACTIVE_ADMIN' };
    }
    if (this.isLegacyAdminWallet(user)) {
      return { allowed: true, reason: 'LEGACY_ADMIN_WALLET' };
    }
    return { allowed: false, reason: 'NOT_ADMIN' };
  }

  async assertAdmin(userId: string | undefined | null): Promise<User> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    const user = await this.loadUser(userId);
    const decision = this.decide(user);
    if (!decision.allowed || !user) {
      if (decision.reason === 'UNKNOWN_ACCOUNT') {
        throw new UnauthorizedException('Account is not linked');
      }
      throw new ForbiddenException('Admin access denied');
    }
    return user;
  }

  /**
   * MFA layer. Reads the Supabase authenticator assurance level that was taken
   * from the VERIFIED access token — never from frontend state, query params,
   * request bodies or custom headers.
   *
   * Pure decision function (no logging, no secrets).
   */
  decideMfa(aal?: string | null): AdminMfaDecision {
    const level: 'aal1' | 'aal2' = aal === 'aal2' ? 'aal2' : 'aal1';

    return level === 'aal2'
      ? { allowed: true, reason: 'AAL2_SATISFIED', aal: level }
      : { allowed: false, reason: 'MFA_REQUIRED', aal: level };
  }

  /**
   * Enforces the MFA layer for sensitive admin operations.
   * Callers MUST have passed `assertAdmin` first, otherwise a non-admin would
   * receive ADMIN_MFA_REQUIRED instead of "Admin access denied".
   */
  assertAdminMfa(aal?: string | null): AdminMfaDecision {
    const decision = this.decideMfa(aal);

    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: ADMIN_MFA_REQUIRED_CODE,
        message: 'Admin MFA required',
        aal: decision.aal,
      });
    }

    return decision;
  }

  private isLegacyAdminWallet(user: User): boolean {
    const adminWallet = (this.configService.get<string>('ADMIN_WALLET') ?? '').trim();
    if (!adminWallet || !user.walletAddress) return false;
    try {
      return user.walletAddress.toLowerCase() === adminWallet.toLowerCase();
    } catch {
      return false;
    }
  }
}
