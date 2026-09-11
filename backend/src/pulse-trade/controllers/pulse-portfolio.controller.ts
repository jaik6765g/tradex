import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
  Query,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { PulseTradeService } from '../services/pulse-trade.service';
import { PulseTradeAdminService } from '../services/pulse-trade-admin.service';
import { AdminTradeQueryDto } from '../dtos/admin-trade-query.dto';
import { AdminAdjustLiquidityDto } from '../dtos/admin-adjust-liquidity.dto';
import { AdminLiquidityActivityQueryDto } from '../dtos/admin-liquidity-activity-query.dto';

@ApiTags('pulse-trade')
@Controller('pulse-trade')
export class PulsePortfolioController {
  constructor(
    private readonly pulseTradeService: PulseTradeService,
    private readonly pulseTradeAdminService: PulseTradeAdminService,
  ) {}

  // ============ USER ENDPOINTS ============

  @Get('portfolio')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse user portfolio summary' })
  async getPortfolio(@Request() req: AuthenticatedRequest) {
    return this.pulseTradeService.getPortfolio(req.user.id);
  }

  @Get('liquidity')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse liquidity summary' })
  async getLiquidity(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeService.getLiquidity();
  }

  @Get('risk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse risk summary' })
  async getRisk(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeService.getRisk();
  }

  // ============ ADMIN ENDPOINTS ============

  @Get('admin/liquidity')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse liquidity summary (admin)' })
  async getAdminLiquidity(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeService.getLiquidity();
  }

  @Get('admin/risk')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse risk summary (admin)' })
  async getAdminRisk(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeService.getRisk();
  }

  @Post('admin/liquidity/adjust')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Adjust pulse liquidity pool balance (admin)' })
  async adjustAdminLiquidity(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AdminAdjustLiquidityDto,
  ) {
    const forwardedIp = req.headers['x-forwarded-for'];

    const ipAddress =
      typeof forwardedIp === 'string'
        ? (forwardedIp.split(',')[0]?.trim() ?? null)
        : Array.isArray(forwardedIp)
          ? (forwardedIp[0] ?? null)
          : (req.ip ?? null);

    return this.pulseTradeService.adjustAdminLiquidity(req.user.id, dto, {
      ipAddress,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Get('admin/liquidity/activity')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse liquidity adjustment activity (admin)' })
  async getAdminLiquidityActivity(
    @Request() _req: AuthenticatedRequest,
    @Query() query: AdminLiquidityActivityQueryDto,
  ) {
    return this.pulseTradeService.getAdminLiquidityActivity(query);
  }

  @Get('admin/trades')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all pulse trades (admin)' })
  async getAdminTrades(
    @Request() _req: AuthenticatedRequest,
    @Query() query: AdminTradeQueryDto,
  ) {
    return this.pulseTradeAdminService.getAdminTrades(query);
  }

  @Get('admin/trades/:tradeId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse trade detail (admin)' })
  async getAdminTradeById(
    @Request() _req: AuthenticatedRequest,
    @Param('tradeId') tradeId: string,
  ) {
    return this.pulseTradeAdminService.getAdminTradeById(tradeId);
  }

  @Get('admin/metrics')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse trade admin metrics' })
  async getAdminTradeMetrics(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeAdminService.getAdminTradeMetrics();
  }
}
