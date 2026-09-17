import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { AllowAdminMfaPending } from './guards/admin-mfa-exempt.decorator';
import type { AuthenticatedRequest } from './interfaces/authenticated-request.interface';
import { AdminAuthService } from './admin-auth.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminMfaEventDto } from './dto/admin-mfa.dto';

/**
 * Backend-authoritative admin gate + admin MFA lifecycle.
 *
 * These are the ONLY admin routes exempted from the AAL2 requirement (via
 * @AllowAdminMfaPending): an active admin whose session is still AAL1 must be
 * able to (a) discover they are an admin, (b) read their MFA status and
 * (c) record MFA lifecycle audit events. JwtAuthGuard + the AdminAccessPolicy
 * role/status check still apply — only the MFA layer is relaxed here.
 *
 * Every other admin endpoint requires AAL2.
 */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly adminMfa: AdminMfaService,
  ) {}

  @Get('verify')
  @AllowAdminMfaPending()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify the caller is an active admin and report MFA/AAL state',
  })
  async verify(@Request() req: AuthenticatedRequest) {
    try {
      return {
        success: true,
        data: await this.adminAuth.verify(req.user.id, this.requestMeta(req), {
          authUserId: req.user.authUserId,
          aal: req.user.aal,
        }),
      };
    } catch (err) {
      const status = (err as { status?: number }).status ?? 403;
      throw new HttpException('Admin access denied', status);
    }
  }

  @Get('mfa/status')
  @AllowAdminMfaPending()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Safe MFA metadata for the current admin session (no secrets)',
  })
  async mfaStatus(@Request() req: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.adminMfa.getStatus(
        req.user.id,
        req.user.authUserId,
        req.user.aal,
      ),
    };
  }

  @Post('mfa/events')
  @AllowAdminMfaPending()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Record an allow-listed admin MFA lifecycle audit event',
  })
  async mfaEvent(
    @Request() req: AuthenticatedRequest,
    @Body() body: AdminMfaEventDto,
  ) {
    return {
      success: true,
      data: await this.adminMfa.recordEvent({
        userId: req.user.id,
        aal: req.user.aal,
        event: body.event,
        factorId: body.factorId,
        factorCount: body.factorCount,
        result: body.result,
        meta: this.requestMeta(req),
      }),
    };
  }

  private requestMeta(req: AuthenticatedRequest): {
    ip: string | null;
    ua: string | null;
  } {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string'
        ? (forwarded.split(',')[0]?.trim() ?? null)
        : Array.isArray(forwarded)
          ? (forwarded[0] ?? null)
          : (req.ip ?? null);

    return { ip, ua: req.get('user-agent') ?? null };
  }
}
