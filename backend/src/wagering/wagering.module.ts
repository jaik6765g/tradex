import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminAuthModule } from '../auth/admin-auth.module';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { Deposit } from '../deposits/deposit.entity';
import { LedgerEntry } from '../ledger/ledger.entity';
import { LottoTicket } from '../modules/lotto/entities/lotto-ticket.entity';
import { Trade } from '../pulse-trade/entities/trade.entity';

import { WageringObligation } from './entities/wagering-obligation.entity';
import { WageringEvent } from './entities/wagering-event.entity';
import { WageringNotification } from './entities/wagering-notification.entity';
import { WageringSettings } from './entities/wagering-settings.entity';
import { WageringUserOverride } from './entities/wagering-user-override.entity';
import { WalletSourceAllocation } from './entities/wallet-source-allocation.entity';
import { WageringAdminController } from './wagering-admin.controller';
import { WageringController } from './wagering.controller';
import { WageringReconciliationProcessor } from './wagering-reconciliation.processor';
import { WageringService } from './wagering.service';
import { WalletSourceService } from './wallet-source.service';

/**
 * Standalone wagering module — imports no other FEATURE module, so deposit,
 * withdrawals, lotto and pulse-trade can safely depend on it without cycles.
 * AdminAuthModule is the one exception: it is the canonical, leaf owner of
 * AdminAccessPolicy/AdminGuard (it imports only TypeORM entities + Redis),
 * and every AdminGuard-protected controller must resolve them through the
 * SAME exported providers. Without this import, Nest fails to resolve
 * AdminGuard's AdminAccessPolicy dependency inside WageringModule's injector
 * context ("AdminAccessPolicy at index [0] is unavailable").
 * It reads balances/ledger/deposits for reconciliation evidence only; it never
 * writes to balances or ledger_entries.
 */
@Module({
  imports: [
    AdminAuthModule,
    TypeOrmModule.forFeature([
      WageringSettings,
      WageringUserOverride,
      WageringObligation,
      WageringEvent,
      WageringNotification,
      WalletSourceAllocation,
      AdminAuditLog,
      Deposit,
      LedgerEntry,
      // Read-only reconstruction sources for event reconciliation.
      LottoTicket,
      Trade,
    ]),
  ],
  controllers: [WageringController, WageringAdminController],
  providers: [
    WageringService,
    WalletSourceService,
    WageringReconciliationProcessor,
  ],
  exports: [WageringService, WalletSourceService],
})
export class WageringModule implements OnApplicationBootstrap {
  constructor(
    private readonly reconciliationProcessor: WageringReconciliationProcessor,
  ) {}

  onApplicationBootstrap(): void {
    this.reconciliationProcessor.start();
  }
}