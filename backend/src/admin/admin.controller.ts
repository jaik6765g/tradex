import {
  Body,
  Controller,
  Get,
  Param,
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
import { AdminFinancialOverviewService } from './admin-financial-overview.service';
import {
  DistributeBonusDto,
  QueryAdminBonusHistoryDto,
} from './dto/admin-bonus.dto';
import { QueryAdminAuditLogsDto } from './dto/query-admin-audit-logs.dto';
import { QueryAdminSettingsDto } from './dto/query-admin-settings.dto';
import { UpdateAdminSettingDto } from './dto/update-admin-setting.dto';
import { ReviewBelowMinimumDepositDto } from './dto/review-below-minimum-deposit.dto';
import { AdminService } from './admin.service';
import { DepositService } from '../deposits/deposit.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly financialOverviewService: AdminFinancialOverviewService,
    private readonly depositService: DepositService,
  ) {}

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get admin audit logs' })
  async getAuditLogs(@Query() query: QueryAdminAuditLogsDto) {
    return this.adminService.getAuditLogs(query);
  }

  // ============================================================
  // ADMIN: FINANCIAL OVERVIEW
  // ============================================================

  /**
   * ------------------------------------------------------------
   * FINANCIAL OVERVIEW
   * ------------------------------------------------------------
   *
   * Single endpoint that aggregates the complete TDX financial
   * picture from the database:
   *
   * - All users TDX (balances table)
   * - Lifetime user deposits / withdrawals (ledger)
   * - Platform liquidity pool (admin_settings)
   * - Reserved / used / available liquidity (pulse trades)
   * - Admin-added liquidity (admin audit ledger)
   * - Bot trade liquidity (bot wallets / activations)
   * - Lotto fee / revenue pool (admin_pool)
   * - Consolidated totals + recent liquidity activity
   *
   * Every section carries its DB source and an availability flag.
   * If one source is unavailable the rest still render.
   */
  @Get('financial-overview')
  @ApiOperation({
    summary:
      'Get the complete TDX financial overview for the admin dashboard',
  })
  @ApiBearerAuth()
  async getFinancialOverview() {
    const data = await this.financialOverviewService.getFinancialOverview();

    return {
      success: true,
      data,
      message: 'Financial overview loaded',
    };
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get admin settings' })
  async getSettings(@Query() query: QueryAdminSettingsDto) {
    return this.adminService.getSettings(query);
  }

  @Put('settings/:key')
  @ApiOperation({ summary: 'Update admin setting' })
  async updateSetting(
    @Request() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() dto: UpdateAdminSettingDto,
  ) {
    const forwardedIp = req.headers['x-forwarded-for'];

    const ipAddress =
      typeof forwardedIp === 'string'
        ? (forwardedIp.split(',')[0]?.trim() ?? null)
        : Array.isArray(forwardedIp)
          ? (forwardedIp[0] ?? null)
          : (req.ip ?? null);

    return this.adminService.updateSetting(key, dto, {
      adminId: req.user.id,
      ipAddress,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  // ============================================================
  // ADMIN: MANUAL BONUS DISTRIBUTION
  // ============================================================

  /**
   * Distribute a manual bonus to a user (by UUID) with a mandatory
   * reason. Credits the balance, writes a ledger entry and an audit
   * log entry inside one atomic transaction.
   */
  @Post('bonus/distribute')
  @ApiOperation({
    summary: 'Distribute a manual bonus to a user (with reason)',
  })
  async distributeBonus(
    @Request() req: AuthenticatedRequest,
    @Body() dto: DistributeBonusDto,
  ) {
    const result = await this.adminService.distributeBonus(dto, {
      adminId: req.user.id,
      adminEmail: req.user.email ?? null,
      ipAddress: this.extractClientIp(req),
      userAgent: req.get('user-agent') ?? null,
      requestId:
        (req as AuthenticatedRequest & { requestId?: string }).requestId ?? null,
    });

    return {
      success: true,
      data: result,
      message: result.replayed
        ? 'Bonus already distributed for this idempotency key (no double credit)'
        : 'Bonus distributed successfully',
    };
  }

  /**
   * Manual bonus distribution history. Each item carries the reason
   * (description), amount, admin identity and timestamp.
   */
  @Get('bonus/history')
  @ApiOperation({
    summary: 'Manual bonus distribution history (with reasons)',
  })
  async getBonusHistory(@Query() query: QueryAdminBonusHistoryDto) {
    const data = await this.adminService.getBonusHistory(query);

    return {
      success: true,
      data,
      message: 'Bonus history loaded',
    };
  }

  // ============================================================
  // ADMIN: BELOW-MINIMUM DEPOSIT REVIEW (Architecture Plan v3)
  // ============================================================
  //
  // On-chain deposits below the configured minimum are recorded with the
  // reviewable BELOW_MINIMUM status and never auto-credited. These endpoints
  // let an authorized admin (AdminGuard + MFA/AAL2, mandatory reason) inspect
  // them and decide CREDIT (detection-time rate) or REJECT. The decision,
  // the balance/ledger mutation and the audit row are atomic and idempotent.

  @Get('deposits/below-minimum')
  @ApiOperation({ summary: 'List deposits awaiting below-minimum review' })
  async listBelowMinimumDeposits(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Number(limit ?? '50');
    const parsedOffset = Number(offset ?? '0');

    const data = await this.depositService.listBelowMinimumDeposits(
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50,
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0,
    );

    return {
      success: true,
      data: data.items,
      total: data.total,
      message: 'Below-minimum deposits loaded',
    };
  }

  @Post('deposits/:id/below-minimum/review')
  @ApiOperation({
    summary: 'Decide a below-minimum deposit (CREDIT with detection-time rate, or REJECT); reason required',
  })
  async reviewBelowMinimumDeposit(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReviewBelowMinimumDepositDto,
  ) {
    const result = await this.depositService.reviewBelowMinimumDeposit(
      id,
      dto.decision,
      dto.reason,
      {
        adminId: req.user.id,
        ipAddress: this.extractClientIp(req),
        userAgent: req.get('user-agent') ?? null,
      },
    );

    return {
      success: true,
      data: result,
      message:
        dto.decision === 'CREDIT'
          ? 'Below-minimum deposit credited with the captured detection-time rate'
          : 'Below-minimum deposit rejected (no credit)',
    };
  }

  private extractClientIp(req: AuthenticatedRequest): string | null {
    const forwardedIp = req.headers['x-forwarded-for'];

    if (typeof forwardedIp === 'string') {
      return (forwardedIp.split(',')[0]?.trim() ?? null) || null;
    }

    if (Array.isArray(forwardedIp)) {
      return (forwardedIp[0] ?? null) || null;
    }

    return req.ip ?? null;
  }
}
