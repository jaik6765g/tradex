import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DepositService } from '../deposit.service';

/**
 * Automatic deposit-credit worker.
 *
 * ALL crediting now goes through DepositService.creditDepositAtomic(), which
 * performs the row lock, idempotency check, balance credit, ledger entry,
 * FIFO source attribution, wagering obligation and status update in ONE
 * database transaction. This processor no longer touches balances/ledger
 * directly, so a crashed or retried job can never double-credit a deposit.
 */
@Injectable()
export class DepositCreditProcessor {
  private readonly logger = new Logger(DepositCreditProcessor.name);

  constructor(private readonly depositService: DepositService) {}

  async handleDepositCredit(job: Job): Promise<void> {
    const { depositId, userId } = job.data as {
      depositId: string;
      userId: string;
    };

    this.logger.log(`Crediting deposit ${depositId} (user ${userId})`);

    const result = await this.depositService.creditDepositAtomic(depositId);

    if (result.alreadyCredited) {
      this.logger.warn(
        `Deposit ${depositId} was already credited — idempotent no-op`,
      );
      return;
    }

    this.logger.log(
      `Deposit ${depositId} credited atomically ` +
        `(ledger ${result.ledgerEntryId}, obligationCreated=${result.obligationCreated})`,
    );
  }
}
