import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Trade } from './entities/trade.entity';
import { TradeSnapshot } from './entities/trade-snapshot.entity';
import { Balance } from '../balances/balance.entity';
import { LedgerEntry } from '../ledger/ledger.entity';
import {
  BinancePriceProvider,
  PULSE_MARKET_PRICE_PROVIDERS,
  PriceService,
} from './services/price-service';
import { LiquidityService } from './services/liquidity-service';
import { RiskService } from './services/risk-service';
import { PulseRepository } from './repositories/pulse.repository';
import { TradeRepository } from './repositories/trade.repository';
import { PulseMarketController } from './controllers/pulse-market.controller';
import { PulseTradeController } from './controllers/pulse-trade.controller';
import { PulsePortfolioController } from './controllers/pulse-portfolio.controller';
import { PulseTradeService } from './services/pulse-trade.service';
import { PulseSettlementScheduler } from './workers/pulse-settlement.scheduler';
import { PulseSettlementProcessor } from './workers/pulse-settlement.processor';
import { PULSE_SETTLEMENT_QUEUE } from './workers/pulse-settlement.queue';
import { BalanceModule } from '../balances/balance.module';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { PulseTradeAdminService } from './services/pulse-trade-admin.service';
import { AdminAuthModule } from '../auth/admin-auth.module';
import { WageringModule } from '../wagering/wagering.module';

@Module({
  imports: [
    AdminAuthModule,
    TypeOrmModule.forFeature([Trade, TradeSnapshot, Balance, LedgerEntry]),
    BullModule.registerQueue({
      name: PULSE_SETTLEMENT_QUEUE,
    }),
    BalanceModule,
    LedgerModule,
    UsersModule,
    WageringModule,
  ],
  controllers: [
    PulseMarketController,
    PulseTradeController,
    PulsePortfolioController,
  ],
  providers: [
    PulseRepository,
    TradeRepository,
    BinancePriceProvider,
    {
      provide: PULSE_MARKET_PRICE_PROVIDERS,
      inject: [BinancePriceProvider],
      useFactory: (binancePriceProvider: BinancePriceProvider) => [
        binancePriceProvider,
      ],
    },
    PriceService,
    LiquidityService,
    RiskService,
    PulseTradeService,
    PulseTradeAdminService,
    PulseSettlementScheduler,
    PulseSettlementProcessor,
  ],
  exports: [
    PulseRepository,
    TradeRepository,
    PriceService,
    LiquidityService,
    RiskService,
  ],
})
export class PulseTradeModule {}
