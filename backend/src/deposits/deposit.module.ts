// src/deposits/deposit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Deposit } from './deposit.entity';
import { DepositService } from './deposit.service';
import { DepositController } from './deposit.controller';
import { DepositDetectionProcessor } from './processors/deposit-detection.processor';
import { DepositConfirmationProcessor } from './processors/deposit-confirmation.processor';
import { DepositCreditProcessor } from './processors/deposit-credit.processor';
import { BalanceModule } from '../balances/balance.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Deposit]),
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
  ],
  controllers: [DepositController],
  providers: [
    DepositService,
    DepositDetectionProcessor,
    DepositConfirmationProcessor,
    DepositCreditProcessor,
  ],
  exports: [DepositService],
})
export class DepositModule {}
