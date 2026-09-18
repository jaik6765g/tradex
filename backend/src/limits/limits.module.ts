// backend/src/limits/limits.module.ts

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminSetting } from '../admin/entities/admin-setting.entity';
import { LimitsService } from './limits.service';

/**
 * Global module so every feature module (withdrawals, deposit gateway,
 * deposits, admin) can inject LimitsService without wiring it everywhere.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminSetting])],
  providers: [LimitsService],
  exports: [LimitsService],
})
export class LimitsModule {}
