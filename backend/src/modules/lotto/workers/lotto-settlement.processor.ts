import { Injectable, Logger } from '@nestjs/common';
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

import { LottoService } from '../lotto.service';
import {
  LOTTO_SETTLEMENT_QUEUE,
  LOTTO_SETTLEMENT_SCAN_JOB,
  LOTTO_SETTLEMENT_SETTLE_JOB,
  lottoSettlementRoundJobId,
} from './lotto-settlement.queue';

interface LottoSettleRoundJobData {
  roundId: number;
}

@Processor(LOTTO_SETTLEMENT_QUEUE)
@Injectable()
export class LottoSettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(LottoSettlementProcessor.name);

  constructor(
    private readonly lottoService: LottoService,
    @InjectQueue(LOTTO_SETTLEMENT_QUEUE)
    private readonly lottoSettlementQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === LOTTO_SETTLEMENT_SCAN_JOB) {
      await this.handleScanExpiredRounds();
      return;
    }

    if (job.name === LOTTO_SETTLEMENT_SETTLE_JOB) {
      await this.handleSettleExpiredRound(job as Job<LottoSettleRoundJobData>);
      return;
    }

    this.logger.warn(`Unsupported lotto settlement job received: ${job.name}`);
  }

  private async handleScanExpiredRounds(): Promise<void> {
    const roundIds = await this.lottoService.findExpiredRoundIdsForSettlement();

    for (const roundId of roundIds) {
      await this.lottoSettlementQueue.add(
        LOTTO_SETTLEMENT_SETTLE_JOB,
        { roundId },
        {
          jobId: lottoSettlementRoundJobId(roundId),
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    }
  }

  private async handleSettleExpiredRound(
    job: Job<LottoSettleRoundJobData>,
  ): Promise<void> {
    const roundIdRaw = job.data?.roundId;
    const roundId = Number(roundIdRaw);

    if (!Number.isInteger(roundId) || roundId <= 0) {
      this.logger.warn(`Lotto settle job ${job.id} missing roundId payload`);
      return;
    }

    await this.lottoService.settleRound(roundId);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`Lotto settlement job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    this.logger.error(
      `Lotto settlement job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${error.message}`,
    );

    if (!job || job.name !== LOTTO_SETTLEMENT_SETTLE_JOB) {
      return;
    }

    const roundIdRaw = (job.data as LottoSettleRoundJobData | undefined)
      ?.roundId;
    const roundId = Number(roundIdRaw);
    if (!Number.isInteger(roundId) || roundId <= 0) {
      this.logger.warn(
        `Lotto settle failed job ${job.id} missing roundId payload`,
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

    const reason =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error);

    try {
      await this.lottoService.markRoundSettlementFailed(
        roundId,
        reason,
        normalizedAttemptsMade,
        normalizedMaxAttempts,
      );
    } catch (markError) {
      this.logger.error(
        `Failed to mark round ${roundId} as settlement failed after retries exhausted: ${
          markError instanceof Error ? markError.message : String(markError)
        }`,
      );
    }
  }
}
