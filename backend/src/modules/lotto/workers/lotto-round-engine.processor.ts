import { Injectable, Logger } from '@nestjs/common';
import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { LottoService } from '../lotto.service';
import {
  LOTTO_ROUND_ENGINE_QUEUE,
  LOTTO_ROUND_ENGINE_TICK_JOB,
} from './lotto-round-engine.queue';

@Processor(LOTTO_ROUND_ENGINE_QUEUE)
@Injectable()
export class LottoRoundEngineProcessor extends WorkerHost {
  private readonly logger = new Logger(LottoRoundEngineProcessor.name);

  constructor(private readonly lottoService: LottoService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== LOTTO_ROUND_ENGINE_TICK_JOB) {
      this.logger.warn(`Unsupported lotto round engine job: ${job.name}`);
      return;
    }

    const { created, resulted } = await this.lottoService.tickRoundEngine();

    if (created > 0 || resulted > 0) {
      this.logger.log(
        `Lotto round engine tick: created=${created} resulted=${resulted}`,
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`Lotto round engine job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `Lotto round engine job ${
        job?.id ?? 'unknown'
      } failed: ${error.message}`,
    );
  }
}