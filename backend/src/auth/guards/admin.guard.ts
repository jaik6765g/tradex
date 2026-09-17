import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminAccessPolicy } from '../admin-access.policy';
import { ADMIN_MFA_EXEMPT_KEY } from './admin-mfa-exempt.decorator';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Backend-authoritative admin authorization.
 *
 * Layers, in order:
 *   1. JwtAuthGuard (registered alongside) verifies the Supabase access token.
 *   2. AdminAccessPolicy re-reads users.role + users.status from the DB on
 *      EVERY request -> 401 unauthenticated / 403 non-admin.
 *   3. MFA: unless the handler is explicitly marked `@AllowAdminMfaPending()`,
 *      the VERIFIED token's `aal` claim must be `aal2` -> 403
 *      `{ code: 'ADMIN_MFA_REQUIRED' }` for AAL1 sessions.
 *
 * Never trusts frontend claims, localStorage, query params, request bodies or
 * custom headers. Never logs tokens, codes or secrets.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly policy: AdminAccessPolicy,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 1 + 2: authenticated + active admin (DB-authoritative).
    await this.policy.assertAdmin(request?.user?.id);

    // 3: MFA / AAL2 — applied to every admin route by default.
    const mfaPendingAllowed =
      this.reflector?.getAllAndOverride<boolean>(ADMIN_MFA_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (!mfaPendingAllowed) {
      this.policy.assertAdminMfa(request?.user?.aal);
    }

    return true;
  }
}

