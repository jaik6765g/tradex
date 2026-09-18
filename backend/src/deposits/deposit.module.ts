// src/deposits/deposit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Deposit } from './deposit.entity';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { DepositService } from './deposit.service';
import { DepositController } from './deposit.controller';
import { DepositDetectionProcessor } from './processors/deposit-detection.processor';
import { DepositConfirmationProcessor } from './processors/deposit-confirmation.processor';
import { DepositCreditProcessor } from './processors/deposit-credit.processor';
import { EvmDepositConfirmationHandler } from './processors/evm-deposit-confirmation.handler';
import { BalanceModule } from '../balances/balance.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { WageringModule } from '../wagering/wagering.module';

@Module({
  imports: [
    AdminAuthModule,
    TypeOrmModule.forFeature([Deposit, AdminAuditLog]),
    BullModule.registerQueue({
      name: 'deposit-detection',
    }),
    BullModule.registerQueue({
      name: 'deposit-confirmation',
    }),
    BalanceModule,
    LedgerModule,
    WalletsModule,
    UsersModule,
    BlockchainModule,
    ConfigModule,
    WageringModule,
  ],
  controllers: [DepositController],
  providers: [
    DepositService,
    DepositDetectionProcessor,
    DepositConfirmationProcessor,
    DepositCreditProcessor,
    EvmDepositConfirmationHandler,
  ],
  exports: [DepositService],
})
export class DepositModule {}
