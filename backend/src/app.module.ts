import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { parseRedisUrl } from './redis/redis-connection';
import { RedisModule } from './redis/redis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Entities
import { User } from './users/user.entity';
import { Wallet } from './wallets/wallet.entity';
import { Balance } from './balances/balance.entity';
import { Deposit } from './deposits/deposit.entity';
import { DepositOrder } from './deposit-gateway/orders/deposit-order.entity';
import { DepositAddress } from './deposit-gateway/addresses/deposit-address.entity';
import { GatewayWatcherState } from './deposit-gateway/watchers/gateway-watcher-state.entity';
import { DepositSweep } from './deposit-gateway/sweeps/deposit-sweep.entity';
import { BscGasBatch } from './deposit-gateway/admin-bsc-gas/entities/bsc-gas-batch.entity';
import { BscGasTransfer } from './deposit-gateway/admin-bsc-gas/entities/bsc-gas-transfer.entity';
import { LedgerEntry } from './ledger/ledger.entity';
import { Withdrawal } from './withdrawals/entities/withdrawal.entity';
import { Trade } from './pulse-trade/entities/trade.entity';
import { TradeSnapshot } from './pulse-trade/entities/trade-snapshot.entity';
import { AdminAuditLog } from './admin/entities/admin-audit-log.entity';
import { AdminSetting } from './admin/entities/admin-setting.entity';
import { LottoRound } from './modules/lotto/entities/lotto-round.entity';
import { LottoTicket } from './modules/lotto/entities/lotto-ticket.entity';
import { LottoResult } from './modules/lotto/entities/lotto-result.entity';
import { LottoSettlement } from './modules/lotto/entities/lotto-settlement.entity';
import { ReferralBonus } from './modules/lotto/entities/referral-bonus.entity';
import { AdminPool } from './modules/lotto/entities/admin-pool.entity';
import { AdminPoolTransaction } from './modules/lotto/entities/admin-pool-transaction.entity';
import { AdminAction } from './modules/lotto/entities/admin-action.entity';
import { SystemSetting } from './modules/lotto/entities/system-setting.entity';

import { PulseTradeModule } from './pulse-trade/pulse-trade.module';

// Bot entities
import { BotAccount } from './bot/entities/bot-account.entity';
import { BotWallet } from './bot/entities/bot-wallet.entity';
import { BotWalletTransaction } from './bot/entities/bot-wallet-transaction.entity';
import { BotActivation } from './bot/entities/bot-activation.entity';
import { BotMonthlySettlement } from './bot/entities/bot-monthly-settlement.entity';
import { BotSetting } from './bot/entities/bot-setting.entity';

// Modules
import { AuthModule } from './auth/auth.module';
import { AdminAuthModule } from './auth/admin-auth.module';
import { SupabaseModule } from './supabase/supabase.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { BalanceModule } from './balances/balance.module';
import { DepositModule } from './deposits/deposit.module';
import { LedgerModule } from './ledger/ledger.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { AdminModule } from './admin/admin.module';
import { LottoModule } from './modules/lotto/lotto.module';
import { PeriodSyncModule } from './modules/period-sync/period-sync.module';
import { WingoPeriod } from './modules/period-sync/wingo-period.entity';
import { BotModule } from './bot/bot.module';
import { DepositGatewayModule } from './deposit-gateway/gateway.module';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: Number(configService.get<string>('DATABASE_PORT', '5432')),
        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD') || '',
        database: configService.get<string>('DATABASE_NAME', 'tradex'),
        entities: [
          User,
          Wallet,
          Balance,
          Deposit,
          DepositOrder,
          DepositAddress,
          GatewayWatcherState,
          DepositSweep,
          BscGasBatch,
          BscGasTransfer,
          LedgerEntry,
          Withdrawal,
          Trade,
          TradeSnapshot,
          AdminAuditLog,
          AdminSetting,
          LottoRound,
          LottoTicket,
          LottoResult,
          LottoSettlement,
          ReferralBonus,
          AdminPool,
          AdminPoolTransaction,
          AdminAction,
          SystemSetting,
          // Bot System
          BotAccount,
          BotWallet,
          BotWalletTransaction,
          BotActivation,
          SystemSetting,
          WingoPeriod,
          // Bot System
          BotMonthlySettlement,
          BotSetting,
        ],
        synchronize: false,
        // Query logging floods production logs with every SELECT —
        // enable only outside production (or via DATABASE_LOGGING=true).
        logging:
          configService.get<string>('NODE_ENV', 'development') !==
            'production' ||
          configService.get<boolean>('DATABASE_LOGGING', false) === true,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (!redisUrl) {
          throw new Error('REDIS_URL is not configured');
        }

        // BullMQ (ioredis) does not accept a `url` key inside the connection
        // options object, so REDIS_URL is parsed into the fields ioredis
        // expects. Queue producers, processors and the app-level Redis client
        // (RedisModule) all share this connection configuration. (The cast
        // preserves the original `Record<string, unknown>` typing BullMQ's
        // ConnectionOptions expects in this bullmq version.)
        return {
          connection: parseRedisUrl(redisUrl) as unknown as Record<
            string,
            unknown
          >,
        };
      },
    }),
    RedisModule,
    SupabaseModule,
    AuthModule,
    AdminAuthModule,
    UsersModule,
    WalletsModule,
    BalanceModule,
    DepositModule,
    LedgerModule,
    AdminModule,
    LottoModule,
    PeriodSyncModule,
    BotModule,
    BlockchainModule,
    WithdrawalsModule,
    PulseTradeModule,
    LottoModule,
    BotModule, // ✅ BotModule is already imported here
    DepositGatewayModule,
  ],
})
export class AppModule {}
