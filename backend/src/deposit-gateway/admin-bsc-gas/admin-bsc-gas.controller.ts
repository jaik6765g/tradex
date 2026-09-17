import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { BscGasStatusService } from './bsc-gas-status.service';
import { BscGasBatchService } from './bsc-gas-batch.service';
import { BscBulkSweepDto, BscGasBatchPreviewDto, BscGasBatchSendDto } from './dto/bsc-gas.dto';

/**
 * Admin-only BSC gas + sweep operational control panel (manual).
 * All routes: JWT + AdminGuard. Backend is authoritative for gas/sweep state.
 * Never returns secrets. No auto-sweep, no auto-top-up.
 */
@Controller('admin/deposit-gateway/bsc')
@UseGuards(JwtAuthGuard, AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminBscGasController {
  constructor(
    private readonly status: BscGasStatusService,
    private readonly batches: BscGasBatchService,
  ) {}

  @Get('gas')
  async gas(@Query('status') _status?: string) {
    const rows = await this.status.listRows();
    const filtered = _status ? rows.filter((r) => r.opStatus === _status) : rows;
    return {
      network: 'bsc',
      chainId: 56,
      treasury: this.status.treasury(),
      gasWallet: await this.gasWalletPreview(),
      rows: filtered,
      total: filtered.length,
    };
  }

  private async gasWalletPreview() {
    const svc: any = (this.batches as any).gasWallet;
    return { address: svc?.getAddress?.() ?? null, configured: !!svc?.isConfigured?.() };
  }

  @Get('gas/export')
  async exportCsv(@Res() res: Response) {
    const rows = await this.status.listRows();
    const csv = this.status.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bsc-gas-sweep.csv"');
    res.send(csv);
  }

  @Post('gas/batch-preview')
  async preview(@Body() dto: BscGasBatchPreviewDto) {
    return this.batches.preview(dto.recipients, { allowZeroUsdt: dto.allowZeroUsdt });
  }

  @Post('gas/batch-send')
  async send(@Request() req: AuthenticatedRequest, @Body() dto: BscGasBatchSendDto) {
    return this.batches.send(
      { recipients: dto.recipients, idempotencyKey: dto.idempotencyKey, confirmed: dto.confirmed, allowZeroUsdt: dto.allowZeroUsdt },
      req.user?.id ?? null,
    );
  }

  @Get('gas/batches/:id')
  async batch(@Param('id') id: string) {
    return this.batches.getBatch(id);
  }

  @Post('sweeps/bulk-execute')
  async bulk(@Request() req: AuthenticatedRequest, @Body() dto: BscBulkSweepDto) {
    return this.batches.bulkExecute(dto.depositAddressIds, req.user?.id ?? null);
  }

  /** Legacy alias per spec: /sweeps/:sweepId/execute is NOT address-safe, so we keep address-based only. */
  @Post('sweeps/address/:depositAddressId/execute')
  async executeOne(@Request() req: AuthenticatedRequest, @Param('depositAddressId') depositAddressId: string) {
    return this.batches.executeSweepForAddress(depositAddressId, req.user?.id ?? null);
  }

  @Post('sweeps/:sweepId/execute')
  async executeBySweepId(@Request() req: AuthenticatedRequest, @Param('sweepId') sweepId: string) {
    return this.batches.executeSweepById(sweepId, req.user?.id ?? null);
  }
}
