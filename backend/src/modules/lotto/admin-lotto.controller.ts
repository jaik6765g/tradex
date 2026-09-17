import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { AdminLottoLiquidityDto } from './dto/admin-lotto-liquidity.dto';
import { AdminLottoManualResultDto } from './dto/admin-lotto-manual-result.dto';
import { AdminLottoResultModeDto } from './dto/admin-lotto-result-mode.dto';
import { AdminLottoWinStrategyDto } from './dto/admin-lotto-win-strategy.dto';
import { AdminLottoResultsQueryDto } from './dto/admin-lotto-results-query.dto';
import { AdminLottoRoundsQueryDto } from './dto/admin-lotto-rounds-query.dto';
import { AdminLottoTicketsQueryDto } from './dto/admin-lotto-tickets-query.dto';
import { LottoService } from './lotto.service';
import { LottoBetExposureService } from './services/lotto-bet-exposure.service';
import { Category } from './entities/lotto-round.entity';

interface AdminContextInput {
  adminId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@ApiTags('admin-lotto')
@Controller('admin/lotto')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminLottoController {
  constructor(
    private readonly lottoService: LottoService,
    private readonly exposureService: LottoBetExposureService,
  ) {}

  private static adminContext(req: AuthenticatedRequest): AdminContextInput {
    const forwardedIp = req.headers['x-forwarded-for'];

    const ipAddress =
      typeof forwardedIp === 'string'
        ? (forwardedIp.split(',')[0]?.trim() ?? null)
        : Array.isArray(forwardedIp)
          ? (forwardedIp[0] ?? null)
          : (req.ip ?? null);

    return {
      adminId: req.user.id,
      ipAddress,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  private resolveCategory(category?: string): Category {
    const normalized = (category ?? Category.THIRTY_SEC).trim().toUpperCase();
    const valid = new Set(Object.values(Category));
    return valid.has(normalized as Category) ? (normalized as Category) : Category.THIRTY_SEC;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Lotto game manager dashboard (real backend data)' })
  async getDashboard() {
    return this.lottoService.getAdminDashboard();
  }

  @Get('current-exposure')
  @ApiOperation({
    summary: 'Real-time TDX exposure by number for the current authoritative period',
  })
  async getCurrentExposure(@Query('category') category?: string) {
    const resolved = this.resolveCategory(category);
    return this.exposureService.getExposure(resolved);
  }

  @Get('rounds')
  @ApiOperation({ summary: 'List lotto rounds with filters' })
  async getRounds(@Query() query: AdminLottoRoundsQueryDto) {
    return this.lottoService.getAdminRounds({
      category: query.category,
      status: query.status,
      q: query.q,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('rounds/:id')
  @ApiOperation({ summary: 'Lotto round detail with tickets' })
  async getRoundDetail(@Param('id', ParseIntPipe) roundId: number) {
    return this.lottoService.getAdminRoundDetail(roundId);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Lotto ticket monitor with server-side filters' })
  async getTickets(@Query() query: AdminLottoTicketsQueryDto) {
    return this.lottoService.getAdminTickets({
      category: query.category,
      roundId: query.roundId,
      ticketId: query.ticketId,
      roundNumber: query.roundNumber,
      status: query.status,
      outcome: query.outcome,
      userId: query.userId,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('results')
  @ApiOperation({ summary: 'Lotto results monitor' })
  async getResults(@Query() query: AdminLottoResultsQueryDto) {
    return this.lottoService.getAdminResults({
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('settings')
  @ApiOperation({ summary: 'Lotto settings (frozen + runtime config)' })
  async getSettings() {
    return this.lottoService.getAdminSettings();
  }

  @Post('pause')
  @ApiOperation({ summary: 'Pause the Lotto game (audited)' })
  async pause(@Request() req: AuthenticatedRequest) {
    return this.lottoService.setGamePaused(
      true,
      AdminLottoController.adminContext(req),
    );
  }

  @Post('resume')
  @ApiOperation({ summary: 'Resume the Lotto game (audited)' })
  async resume(@Request() req: AuthenticatedRequest) {
    return this.lottoService.setGamePaused(
      false,
      AdminLottoController.adminContext(req),
    );
  }

  @Post('rounds/:id/result')
  @ApiOperation({
    summary:
      'Set a round result (source=ADMIN, audited). Locks the symbol when the round has not drawn yet; finalizes it when the draw time has passed.',
  })
  async setManualResult(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) roundId: number,
    @Body() dto: AdminLottoManualResultDto,
  ) {
    return this.lottoService.setAdminResult(
      roundId,
      dto.result,
      req.user.id,
      AdminLottoController.adminContext(req),
      dto.reason,
    );
  }

  @Post('settings/result-mode')
  @ApiOperation({ summary: 'Change active result mode (audited)' })
  async setResultMode(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AdminLottoResultModeDto,
  ) {
    return this.lottoService.setResultMode(
      dto.resultMode,
      AdminLottoController.adminContext(req),
    );
  }

  @Post('settings/win-strategy')
  @ApiOperation({
    summary:
      'Change the win strategy applied to server draws — RANDOM | HIGH | MEDIUM | LOW (audited)',
  })
  async setWinStrategy(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AdminLottoWinStrategyDto,
  ) {
    return this.lottoService.setWinStrategy(
      dto.winStrategy,
      AdminLottoController.adminContext(req),
    );
  }

  @Get('liquidity')
  @ApiOperation({ summary: 'Lotto liquidity / exposure view' })
  async getLiquidity() {
    return this.lottoService.getAdminSettings();
  }

  @Post('liquidity/add')
  @ApiOperation({ summary: 'Add LOTTO liquidity (audited)' })
  async addLiquidity(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AdminLottoLiquidityDto,
  ) {
    return this.lottoService.adjustLiquidity(
      'ADD',
      dto.amount,
      AdminLottoController.adminContext(req),
      dto.reason,
    );
  }

  @Post('liquidity/remove')
  @ApiOperation({ summary: 'Remove LOTTO liquidity (audited, removable only)' })
  async removeLiquidity(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AdminLottoLiquidityDto,
  ) {
    return this.lottoService.adjustLiquidity(
      'REMOVE',
      dto.amount,
      AdminLottoController.adminContext(req),
      dto.reason,
    );
  }
}