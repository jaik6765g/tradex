// src/ledger/ledger.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntry } from './ledger.entity';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { AdminAuthModule } from '../auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry]), AdminAuthModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
