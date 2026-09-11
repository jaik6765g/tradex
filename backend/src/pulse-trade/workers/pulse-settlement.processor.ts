import { Injectable, Logger } from '@nestjs/common';
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

import { PulseTradeService } from '../services/pulse-trade.service';
import {
  PULSE_SETTLEMENT_QUEUE,
  PULSE_SETTLEMENT_SCAN_JOB,
  PULSE_SETTLEMENT_SETTLE_JOB,
  pulseSettlementTradeJobId,
} from './pulse-settlement.queue';

interface PulseSettleTradeJobData {
  tradeId: string;
}

@Processor(PULSE_SETTLEMENT_QUEUE)
@Injectable()
export class PulseSettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(PulseSettlementProcessor.name);

  constructor(
    private readonly pulseTradeService: PulseTradeService,
    @InjectQueue(PULSE_SETTLEMENT_QUEUE)
    private readonly pulseSettlementQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === PULSE_SETTLEMENT_SCAN_JOB) {
      await this.handleScanExpiredTrades();
      return;
    }

    if (job.name === PULSE_SETTLEMENT_SETTLE_JOB) {
      await this.handleSettleExpiredTrade(job as Job<PulseSettleTradeJobData>);
      return;
    }

    this.logger.warn(`Unsupported pulse settlement job received: ${job.name}`);
  }

  private async handleScanExpiredTrades(): Promise<void> {
    const tradeIds =
      await this.pulseTradeService.findExpiredTradeIdsForSettlement();

    for (const tradeId of tradeIds) {
      await this.pulseSettlementQueue.add(
        PULSE_SETTLEMENT_SETTLE_JOB,
        { tradeId },
        {
          jobId: pulseSettlementTradeJobId(tradeId),
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    }
  }

  private async handleSettleExpiredTrade(
    job: Job<PulseSettleTradeJobData>,
  ): Promise<void> {
    const tradeId = job.data?.tradeId;
    if (!tradeId) {
      this.logger.warn(`Pulse settle job ${job.id} missing tradeId payload`);
      return;
    }

    await this.pulseTradeService.settleTrade(tradeId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`Pulse settlement job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    this.logger.error(
      `Pulse settlement job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${error.message}`,
    );

    if (!job || job.name !== PULSE_SETTLEMENT_SETTLE_JOB) {
      return;
    }

    const tradeId = (job.data as PulseSettleTradeJobData | undefined)?.tradeId;
    if (!tradeId) {
      this.logger.warn(
        `Pulse settle failed job ${job.id} missing tradeId payload`,
      );
      return;
    }

    const attemptsMade = Number(job.attemptsMade ?? 0);
    const maxAttempts = Number(job.opts?.attempts ?? 1);
    const normalizedAttemptsMade =
      Number.isFinite(attemptsMade) && attemptsMade >= 0 ? attemptsMade : 0;
    const normalizedMaxAttempts =
      Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;

    if (normalizedAttemptsMade < normalizedMaxAttempts) {
      return;
    }

    try {
      await this.pulseTradeService.markTradeSettlementFailed(
        tradeId,
        error.message,
        normalizedAttemptsMade,
        normalizedMaxAttempts,
      );
    } catch (markError) {
      this.logger.error(
        `Failed to mark trade ${tradeId} as settlement failed after retries exhausted: ${
          markError instanceof Error ? markError.message : String(markError)
        }`,
      );
    }
  }
}
