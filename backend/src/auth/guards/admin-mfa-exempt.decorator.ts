import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key checked by AdminGuard.
 *
 * By default EVERY AdminGuard-protected route additionally requires a verified
 * TOTP MFA session (Supabase AAL2). Only the admin MFA bootstrap routes
 * (`/admin/auth/verify`, `/admin/auth/mfa/status`, `/admin/auth/mfa/events`)
 * are marked with this decorator, because an admin who has not yet verified
 * MFA must still be able to discover their MFA state and finish enrollment.
 *
 * This decorator only relaxes the MFA requirement — the JwtAuthGuard and the
 * AdminAccessPolicy role/status check still apply to those routes.
 */
export const ADMIN_MFA_EXEMPT_KEY = 'tradex:admin-mfa-exempt';

export const AllowAdminMfaPending = () => SetMetadata(ADMIN_MFA_EXEMPT_KEY, true);