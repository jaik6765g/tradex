// backend/src/modules/deposits/deposit.controller.ts

import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  NotFoundException,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DepositService, type DepositAdminStatistics } from './deposit.service';
import { UpdateDepositStatusDto, DepositResponseDto, DepositStatusResponseDto } from './dto/deposit.dto';
import { Deposit, DepositStatus } from './deposit.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@ApiTags('deposits')
@Controller('deposits')
export class DepositController {
  constructor(private depositService: DepositService) {}

  private toResponseDto(deposit: Deposit): DepositResponseDto {
    return {
      id: deposit.id,
      userId: deposit.userId,
      chainId: deposit.chainId,
      transactionHash: deposit.transactionHash,
      usdtAmount: Number(deposit.usdtAmount),
      tdxAmount: Number(deposit.tdxAmount),
      status: deposit.status,
      confirmations: deposit.confirmations,
      requiredConfirmations: deposit.requiredConfirmations,
      createdAt: deposit.createdAt,
      confirmedAt: deposit.confirmedAt ?? undefined,
      creditedAt: deposit.creditedAt ?? undefined,
    };
  }

  // ============================================================
  // USER ENDPOINTS
  // ============================================================

  /**
   * GET USER DEPOSITS WITH PAGINATION
   * 
   * Returns paginated list of user's deposits.
   * Supports limit and offset for pagination.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user deposits with pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Records per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Records to skip (default: 0)' })
  async getUserDeposits(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<{
    data: DepositResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    // ✅ Check if user is authenticated
    if (!req.user?.id) {
      throw new UnauthorizedException('User not authenticated');
    }

    const safeLimit = limit ? Math.min(Math.max(1, limit), 100) : 20;
    const safeOffset = offset ? Math.max(0, offset) : 0;

    const result = await this.depositService.getUserDepositsPaginated(
      req.user.id,
      safeLimit,
      safeOffset,
    );

    return {
      data: result.data.map((deposit) => this.toResponseDto(deposit)),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get deposit by ID' })
  async getDeposit(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DepositResponseDto> {
    const deposit = await this.depositService.getDepositById(id);

    if (req.user.role !== 'admin' && deposit.userId !== req.user.id) {
      throw new NotFoundException('Deposit not found');
    }

    return this.toResponseDto(deposit);
  }

  @Get('tx/:hash')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get deposit by transaction hash' })
  async getDepositByTx(
    @Request() req: AuthenticatedRequest,
    @Param('hash') hash: string,
  ): Promise<DepositResponseDto> {
    const deposit = await this.depositService.getDepositByTransactionHash(hash);
    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    if (req.user.role !== 'admin' && deposit.userId !== req.user.id) {
      throw new NotFoundException('Deposit not found');
    }

    return this.toResponseDto(deposit);
  }

  @Get('tx/:hash/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get poll-friendly deposit status by transaction hash' })
  async getDepositStatusByTx(
    @Request() req: AuthenticatedRequest,
    @Param('hash') hash: string,
  ): Promise<DepositStatusResponseDto> {
    const deposit = await this.depositService.getDepositByTransactionHash(hash);

    if (!deposit || (req.user.role !== 'admin' && deposit.userId !== req.user.id)) {
      return {
        found: false,
        status: DepositStatus.PENDING,
        credited: false,
      };
    }

    return {
      found: true,
      status: deposit.status,
      credited: Boolean(deposit.creditedAt),
    };
  }

  // ============================================================
  // ADMIN ENDPOINTS
  // ============================================================

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all deposits with pagination and filters' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: DepositStatus })
  @ApiQuery({ name: 'search', required: false, type: String })
  async getAllDeposits(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('status') status?: DepositStatus,
    @Query('search') search?: string,
  ): Promise<{
    data: DepositResponseDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const result = await this.depositService.getAllDeposits({
      limit: limit ? Math.min(Math.max(1, limit), 100) : 20,
      offset: offset ? Math.max(0, offset) : 0,
      status,
      search,
    });

    return {
      data: result.data.map((deposit) => this.toResponseDto(deposit)),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get('admin/statistics')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get deposit statistics' })
  async getStatistics(): Promise<DepositAdminStatistics> {
    return this.depositService.getDepositStatistics();
  }

  @Get('admin/pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pending deposits' })
  async getPendingDeposits(): Promise<DepositResponseDto[]> {
    const deposits = await this.depositService.getPendingDeposits();
    return deposits.map((deposit) => this.toResponseDto(deposit));
  }

  @Put('admin/:id/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update deposit status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDepositStatusDto,
  ): Promise<DepositResponseDto> {
    const deposit = await this.depositService.updateDepositStatus(id, dto.status, dto.reason);
    return this.toResponseDto(deposit);
  }

  @Post('admin/:id/credit')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force credit deposit' })
  async creditDeposit(@Param('id') id: string): Promise<DepositResponseDto> {
    const deposit = await this.depositService.creditDeposit(id);
    return this.toResponseDto(deposit);
  }
}