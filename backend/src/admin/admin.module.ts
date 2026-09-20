import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminFinancialOverviewService } from './admin-financial-overview.service';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminSetting } from './entities/admin-setting.entity';

import { Balance } from '../balances/balance.entity';
import { LedgerEntry } from '../ledger/ledger.entity';
import { Trade } from '../pulse-trade/entities/trade.entity';
import { BotWallet } from '../bot/entities/bot-wallet.entity';
import { BotActivation } from '../bot/entities/bot-activation.entity';
import { BotWalletTransaction } from '../bot/entities/bot-wallet-transaction.entity';
import { AdminPool } from '../modules/lotto/entities/admin-pool.entity';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { DepositModule } from '../deposits/deposit.module';
import { WageringModule } from '../wagering/wagering.module';

@Module({
  imports: [
    AdminAuthModule,
    DepositModule,
    WageringModule,
    TypeOrmModule.forFeature([
      AdminAuditLog,
      AdminSetting,
      Balance,
      LedgerEntry,
      Trade,
      BotWallet,
      BotActivation,
      BotWalletTransaction,
      AdminPool,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminFinancialOverviewService],
  exports: [AdminService, AdminFinancialOverviewService],
})
export class AdminModule {}
