// backend/src/modules/period-sync/period-sync.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WingoPeriod } from './wingo-period.entity';
import { PeriodSyncService } from './period-sync.service';
import { PeriodSyncController } from './period-sync.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WingoPeriod])],
  controllers: [PeriodSyncController],
  providers: [PeriodSyncService],
  exports: [PeriodSyncService],
})
export class PeriodSyncModule {}
