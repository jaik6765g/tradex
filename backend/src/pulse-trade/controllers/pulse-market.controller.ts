import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/interfaces/authenticated-request.interface';
import { PulseTradeService } from '../services/pulse-trade.service';

@ApiTags('pulse-trade')
@Controller('pulse-trade')
export class PulseMarketController {
  constructor(private readonly pulseTradeService: PulseTradeService) {}

  @Get('markets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get supported pulse markets' })
  async getMarkets(@Request() _req: AuthenticatedRequest) {
    return this.pulseTradeService.getMarkets();
  }

  @Get('markets/:symbol/price')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get authoritative market price for symbol' })
  async getMarketPrice(
    @Request() _req: AuthenticatedRequest,
    @Param('symbol') symbol: string,
  ) {
    return this.pulseTradeService.getMarketPrice(symbol);
  }
}
