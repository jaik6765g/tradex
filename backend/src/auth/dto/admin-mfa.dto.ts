import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ADMIN_MFA_CLIENT_EVENTS, type AdminMfaClientEvent } from '../admin-mfa.service';

/**
 * Body for POST /admin/auth/mfa/events.
 *
 * Deliberately contains NO TOTP code, secret, QR value, token, password or
 * recovery code field. The global ValidationPipe runs with
 * `forbidNonWhitelisted: true`, so any attempt to smuggle such fields into the
 * request is rejected with 400 before it can be logged or processed.
 */
export class AdminMfaEventDto {
  @IsIn(ADMIN_MFA_CLIENT_EVENTS as unknown as string[])
  event!: AdminMfaClientEvent;

  /** Supabase factor id (opaque, non-secret) for enroll/change bookkeeping. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  factorId?: string;

  /** Number of active factors at the time of the event (safe metadata). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  factorCount?: number;

  /** Safe short outcome label, e.g. 'ok' | 'invalid_code' | 'replaced'. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  result?: string;
}