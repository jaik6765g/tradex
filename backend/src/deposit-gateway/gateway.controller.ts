import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

import { CreateDepositOrderDto } from './orders/dto/create-deposit-order.dto';
import { GatewayService } from './gateway.service';

@Controller('deposit-gateway')
export class GatewayController {
  constructor(private readonly gateway: GatewayService) {}

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  createOrder(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateDepositOrderDto,
  ) {
    return this.gateway.createOrder(req.user.id, dto);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  listOrders(@Request() req: AuthenticatedRequest) {
    return this.gateway.listOrders(req.user.id);
  }

  @Get('orders/active')
  @UseGuards(JwtAuthGuard)
  getActiveOrder(@Request() req: AuthenticatedRequest) {
    return this.gateway.getActiveOrder(req.user.id);
  }

  @Get('orders/:id/status')
  @UseGuards(JwtAuthGuard)
  orderStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.gateway.getOrderStatus(req.user.id, id);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  getOrder(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.gateway.getOrder(req.user.id, id);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard)
  config() {
    return this.gateway.getConfig();
  }

  @Get('admin/orders')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminListOrders() {
    return this.gateway.adminListOrders();
  }

  @Get('admin/addresses')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminListAddresses() {
    return this.gateway.adminListAddresses();
  }

  @Get('admin/sweeps')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminListSweeps() {
    return this.gateway.adminListSweeps();
  }

  @Get('admin/tron-reconciliation')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminListTronReconciliation() {
    return this.gateway.adminListTronReconciliation();
  }

  @Get('admin/tron-readiness')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminTronReadiness() {
    return this.gateway.adminTronReadiness();
  }

  @Get('admin/solana-reconciliation')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminListSolanaReconciliation() {
    return this.gateway.adminListSolanaReconciliation();
  }

  @Get('admin/solana-readiness')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminSolanaReadiness() {
    return this.gateway.adminSolanaReadiness();
  }

  @Get('admin/polygon-readiness')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminPolygonReadiness() {
    return this.gateway.adminPolygonReadiness();
  }

  @Get('admin/arbitrum-readiness')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminArbitrumReadiness() {
    return this.gateway.adminArbitrumReadiness();
  }

  // ---- Custody emergency operations (Custody Hardening) ----

  @Get('admin/custody/status')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminCustodyStatus() {
    return this.gateway.adminCustodyStatus();
  }

  @Get('admin/custody/audit-logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminCustodyAuditLogs() {
    return this.gateway.adminCustodyAuditLogs();
  }
}
