import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { PlaceTradeDto } from '../dtos/place-trade.dto';
import { TradeHistoryQueryDto } from '../dtos/trade-history-query.dto';
import { PulseTradeService } from '../services/pulse-trade.service';

@ApiTags('pulse-trade')
@Controller('pulse-trade')
export class PulseTradeController {
  constructor(private readonly pulseTradeService: PulseTradeService) {}

  @Post('trades')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Place pulse trade with idempotency' })
  async placeTrade(
    @Request() req: AuthenticatedRequest,
    @Body() dto: PlaceTradeDto,
  ) {
    return this.pulseTradeService.placeTrade(req.user.id, dto);
  }

  @Get('trades/open')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user open pulse trades' })
  async getOpenTrades(@Request() req: AuthenticatedRequest) {
    return this.pulseTradeService.getOpenTrades(req.user.id);
  }

  @Get('trades/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user pulse trade history' })
  async getHistory(
    @Request() req: AuthenticatedRequest,
    @Query() query: TradeHistoryQueryDto,
  ) {
    return this.pulseTradeService.getTradeHistory(req.user.id, query);
  }

  @Get('trades/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pulse trade detail' })
  async getTradeById(
    @Request() req: AuthenticatedRequest,
    @Param('id') tradeId: string,
  ) {
    return this.pulseTradeService.getTradeById(req.user.id, tradeId);
  }
}
