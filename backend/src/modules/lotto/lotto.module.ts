// backend/src/modules/lotto/lotto.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { LottoRound } from './entities/lotto-round.entity';
import { LottoTicket } from './entities/lotto-ticket.entity';
import { LottoResult } from './entities/lotto-result.entity';
import { LottoSettlement } from './entities/lotto-settlement.entity';
import { ReferralBonus } from './entities/referral-bonus.entity';
import { AdminPool } from './entities/admin-pool.entity';
import { AdminPoolTransaction } from './entities/admin-pool-transaction.entity';
import { AdminAction } from './entities/admin-action.entity';
import { SystemSetting } from './entities/system-setting.entity';
import { AdminSetting } from '../../admin/entities/admin-setting.entity';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { User } from '../../users/user.entity';
import { LedgerEntry } from '../../ledger/ledger.entity';

import { LottoController } from './lotto.controller';
import { AdminLottoController } from './admin-lotto.controller';

import { LottoService } from './lotto.service';
import { LottoSettlementScheduler } from './workers/lotto-settlement.scheduler';
import { LottoSettlementProcessor } from './workers/lotto-settlement.processor';
import { LOTTO_SETTLEMENT_QUEUE } from './workers/lotto-settlement.queue';
import { LottoRoundEngineScheduler } from './workers/lotto-round-engine.scheduler';
import { LottoRoundEngineProcessor } from './workers/lotto-round-engine.processor';
import { LOTTO_ROUND_ENGINE_QUEUE } from './workers/lotto-round-engine.queue';
import { PeriodSyncModule } from '../period-sync/period-sync.module';
import { LottoBetExposureService } from './services/lotto-bet-exposure.service';
import { LottoWinStrategyService } from './services/lotto-win-strategy.service';
import { AdminAuthModule } from '../../auth/admin-auth.module';
import { WageringModule } from '../../wagering/wagering.module';

@Module({
  imports: [
    AdminAuthModule,
    WageringModule,
    TypeOrmModule.forFeature([
      LottoRound,
      LottoTicket,
      LottoResult,
      LottoSettlement,
      ReferralBonus,
      AdminPool,
      AdminPoolTransaction,
      AdminAction,
      SystemSetting,
      AdminSetting,
      AdminAuditLog,
      User,
      LedgerEntry,
    ]),
    BullModule.registerQueue({
      name: LOTTO_SETTLEMENT_QUEUE,
    }),
    BullModule.registerQueue({
      name: LOTTO_ROUND_ENGINE_QUEUE,
    }),
    PeriodSyncModule,
  ],
  controllers: [LottoController, AdminLottoController],
  providers: [
    LottoService,
    LottoSettlementScheduler,
    LottoSettlementProcessor,
    LottoRoundEngineScheduler,
    LottoRoundEngineProcessor,
    LottoBetExposureService,
    LottoWinStrategyService,
  ],
  exports: [LottoService, LottoBetExposureService, LottoWinStrategyService],
})
export class LottoModule {}
