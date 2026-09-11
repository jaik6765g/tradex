import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BalanceService } from './balance.service';
import { BalanceResponseDto } from './dto/balance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@ApiTags('balances')
@Controller('balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user balance' })
  async getMyBalance(
    @Request() req: AuthenticatedRequest,
  ): Promise<BalanceResponseDto> {
    const balance = await this.balanceService.getBalance(req.user.id);

    return {
      userId: balance.userId,
      availableBalance: Number(Number(balance.availableBalance).toFixed(2)),
      lockedBalance: Number(Number(balance.lockedBalance).toFixed(2)),
      gameLocked: Number(Number(balance.gameLocked).toFixed(2)),
      tradingLocked: Number(Number(balance.tradingLocked).toFixed(2)),
      withdrawalLocked: Number(Number(balance.withdrawalLocked).toFixed(2)),
      totalBalance: Number(Number(balance.totalBalance).toFixed(2)),
    };
  }
}
