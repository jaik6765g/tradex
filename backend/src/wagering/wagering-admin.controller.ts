import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

import {
  CancelObligationDto,
  RemoveWageringOverrideDto,
  SetWageringOverrideDto,
  UpdateWageringSettingsDto,
  WageringAdminQueryDto,
  WageringAuditQueryDto,
} from './dto/wagering.dto';
import { WageringService } from './wagering.service';

/**
 * All routes are JWT-authenticated (JwtAuthGuard populates request.user) and
 * AdminGuard-protected (DB-authoritative role/status re-read on every request,
 * MFA/AAL2 enforced by the guard itself via the verified-token `aal` claim).
 * Every mutation requires a non-empty reason and writes an admin_audit_logs
 * row with targetType='WAGERING' in the same transaction as the change.
 */
@ApiTags('admin-wagering')
@Controller('admin/wagering')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WageringAdminController {
  constructor(private readonly wageringService: WageringService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get global wagering settings' })
  @ApiBearerAuth()
  async getSettings() {
    return this.wageringService.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update global wagering settings (reason required)' })
  @ApiBearerAuth()
  async updateSettings(
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateWageringSettingsDto,
  ) {
    const saved = await this.wageringService.updateSettings(req.user.id, dto);
    return { settings: saved, policyVersion: saved.policyVersion };
  }

  @Get('overrides/:userId')
  @ApiOperation({ summary: 'Get a user wagering override' })
  @ApiBearerAuth()
  async getOverride(@Param('userId') userId: string) {
    return this.wageringService.getOverride(userId);
  }

  @Put('overrides/:userId')
  @ApiOperation({ summary: 'Set a user wagering multiplier override (reason required)' })
  @ApiBearerAuth()
  async setOverride(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: SetWageringOverrideDto,
  ) {
    return this.wageringService.setOverride(
      req.user.id,
      userId,
      dto.multiplier,
      dto.reason,
    );
  }

  @Delete('overrides/:userId')
  @ApiOperation({ summary: 'Remove a user override (revert to global; reason required)' })
  @ApiBearerAuth()
  async removeOverride(
    @Request() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: RemoveWageringOverrideDto,
  ) {
    await this.wageringService.removeOverride(req.user.id, userId, dto.reason);
    return { ok: true };
  }

  @Get('users/:userId/summary')
  @ApiOperation({ summary: 'Admin view of a user wagering summary' })
  @ApiBearerAuth()
  async getUserSummary(@Param('userId') userId: string) {
    const summary = await this.wageringService.getUserSummaryDto(userId);
    const override = await this.wageringService.getOverride(userId);
    return {
      ...summary,
      override: override
        ? {
            multiplier: override.multiplier,
            previousValue: override.previousValue,
            reason: override.reason,
            adminId: override.adminId,
            appliedFrom: override.appliedFrom,
          }
        : null,
    };
  }

  @Get('obligations')
  @ApiOperation({ summary: 'List wagering obligations (active by default)' })
  @ApiBearerAuth()
  async listObligations(@Query() query: WageringAdminQueryDto) {
    const { items, total } = await this.wageringService.listObligations(query);
    return {
      total,
      items: items.map((o) => this.wageringService.toObligationDto(o)),
    };
  }

  @Post('obligations/:id/cancel')
  @ApiOperation({ summary: 'Cancel an ACTIVE obligation (reason required)' })
  @ApiBearerAuth()
  async cancelObligation(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CancelObligationDto,
  ) {
    const saved = await this.wageringService.cancelObligation(
      req.user.id,
      id,
      dto.reason,
    );
    return this.wageringService.toObligationDto(saved);
  }

  @Get('audit')
  @ApiOperation({ summary: 'Wagering audit history' })
  @ApiBearerAuth()
  async getAudit(@Query() query: WageringAuditQueryDto) {
    return this.wageringService.listAudit(query);
  }

  @Post('reconcile')
  @ApiOperation({ summary: 'Run the deposit-obligation reconciliation sweep' })
  @ApiBearerAuth()
  async reconcile(@Request() req: AuthenticatedRequest) {
    return this.wageringService.reconcileDepositObligations(req.user.id);
  }

  @Post('reconcile/events')
  @ApiOperation({ summary: 'Run the settlement wagering-event reconciliation sweep' })
  @ApiBearerAuth()
  async reconcileEvents(@Request() req: AuthenticatedRequest) {
    return this.wageringService.reconcileWageringEvents(req.user.id);
  }
}