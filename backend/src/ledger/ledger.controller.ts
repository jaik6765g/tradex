import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import type { AdminLedgerListResponseDto } from './dto/admin-ledger-response.dto';
import { LedgerResponseDto } from './dto/ledger.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { QueryAdminLedgerDto } from './dto/query-admin-ledger.dto';

@ApiTags('ledger')
@Controller('ledger')
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user ledger entries' })
  async getMyLedger(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<LedgerResponseDto[]> {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.ledgerService.getUserLedgerEntries(
      req.user.id,
      limitNum,
      offsetNum,
    );
  }

  @Get('me/summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ledger summary' })
  async getLedgerSummary(
    @Request() req: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.ledgerService.getLedgerSummary(req.user.id);
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin ledger entries' })
  async getAdminLedger(
    @Query() query: QueryAdminLedgerDto,
  ): Promise<AdminLedgerListResponseDto> {
    return this.ledgerService.getAdminLedgerEntries(query);
  }
}
