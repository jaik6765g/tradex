import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BotController } from './bot.controller';
import { BotService } from './bot.service';

import { BotAccount } from './entities/bot-account.entity';
import { BotWallet } from './entities/bot-wallet.entity';
import { BotWalletTransaction } from './entities/bot-wallet-transaction.entity';
import { BotActivation } from './entities/bot-activation.entity';
import { BotMonthlySettlement } from './entities/bot-monthly-settlement.entity';
import { BotSetting } from './entities/bot-setting.entity';
import { AdminAuthModule } from '../auth/admin-auth.module';

@Module({
  imports: [
    AdminAuthModule,
    TypeOrmModule.forFeature([
      BotAccount,
      BotWallet,
      BotWalletTransaction,
      BotActivation,
      BotMonthlySettlement,
      BotSetting,
    ]),
  ],

  controllers: [BotController],

  providers: [BotService],

  exports: [BotService],
})
export class BotModule {}
