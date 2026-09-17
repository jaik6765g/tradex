import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BotService } from './bot.service';
import { TransferBotWalletDto } from './dto/transfer-bot-wallet.dto';
import { ActivateBotDto } from './dto/activate-bot.dto';
import { UpdateBotSettingsDto } from './dto/update-bot-settings.dto';
import { BotActivityQueryDto } from './dto/query-bot.dto';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
}

@Controller('bot')
@UseGuards(JwtAuthGuard)
export class BotController {
  constructor(private readonly botService: BotService) {}

  /**
   * Create permanent Bot Account.
   *
   * POST /bot/account
   */
  @Post('account')
  async createBotAccount(@Req() req: AuthenticatedRequest) {
    return this.botService.createBotAccount(req.user.id);
  }

  /**
   * Get Bot Account + Bot Wallet.
   *
   * GET /bot/account
   */
  @Get('account')
  async getBotAccount(@Req() req: AuthenticatedRequest) {
    return this.botService.getBotAccount(req.user.id);
  }

  @Get('activity')
  async getBotActivity(
    @Req() req: AuthenticatedRequest,
    @Query() query: BotActivityQueryDto,
  ) {
    return this.botService.getBotActivity(req.user.id, query);
  }

  /**
   * Activate Bot using funds already
   * available in Bot Wallet.
   *
   * POST /bot/account/activate
   */
  @Post('account/activate')
  async activateBot(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ActivateBotDto,
  ) {
    return this.botService.activateBot(
      req.user.id,
      dto.amount,
      dto.idempotencyKey,
    );
  }

  /**
   * Transfer TDX from Main Balance to Bot Wallet.
   *
   * IMPORTANT:
   * This only transfers funds.
   * It does NOT activate the Bot ID.
   *
   * POST /bot/wallet/transfer
   */
  @Post('wallet/transfer')
  async transferToBotWallet(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TransferBotWalletDto,
  ) {
    return this.botService.transferToBotWallet(
      req.user.id,
      dto.amount,
      dto.direction,
    );
  }

  /**
   * Get Bot activation / referral settings.
   *
   * Admin only.
   *
   * GET /bot/settings
   */
  @Get('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getBotSettings() {
    return this.botService.getBotSettings();
  }

  /**
   * Update Bot activation / referral settings.
   *
   * Admin only. Validates financial invariants before saving.
   *
   * PUT /bot/settings
   */
  @Put('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateBotSettings(@Body() dto: UpdateBotSettingsDto) {
    return this.botService.updateBotSettings(dto);
  }
}
