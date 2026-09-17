import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminAccessPolicy } from './admin-access.policy';
import { AdminGuard } from './guards/admin.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminMfaThrottleService } from './admin-mfa-throttle.service';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { User } from '../users/user.entity';
import { RedisModule } from '../redis/redis.module';

/**
 * Central admin authorization module.
 * Registers AdminGuard (with the users repository) ONCE and exports it so
 * every feature module that uses AdminGuard resolves the SAME
 * backend-authoritative, DB-backed implementation.
 * No new auth provider, no wallet-signature auth, no password storage.
 *
 * AdminGuard also enforces the Supabase TOTP MFA (AAL2) layer for every admin
 * route unless the handler is marked `@AllowAdminMfaPending()`.
 *
 * `RedisModule` is imported here (not duplicated) because
 * AdminMfaThrottleService is declared in THIS module and injects
 * `REDIS_CLIENT`. NestJS resolves provider dependencies per module, and
 * RedisModule is intentionally not `@Global()`, so this module must import it
 * explicitly. Nest caches module instances by class, so the RedisModule
 * imported by AppModule and the one imported here are the SAME instance —
 * exactly one application-level Redis client exists.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, AdminAuditLog]), RedisModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAccessPolicy,
    AdminGuard,
    AdminAuthService,
    AdminMfaService,
    AdminMfaThrottleService,
  ],
  exports: [
    AdminAccessPolicy,
    AdminGuard,
    AdminAuthService,
    AdminMfaService,
    AdminMfaThrottleService,
  ],
})
export class AdminAuthModule {}
