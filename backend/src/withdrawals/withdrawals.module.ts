import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { Withdrawal } from './entities/withdrawal.entity';
import { AdminSetting } from '../admin/entities/admin-setting.entity';

import { LedgerModule } from '../ledger/ledger.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { WalletsModule } from '../wallets/wallets.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Withdrawal, AdminSetting]),

    LedgerModule,

    BlockchainModule,

    WalletsModule,

    UsersModule,
  ],

  controllers: [WithdrawalsController],

  providers: [WithdrawalsService],

  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
