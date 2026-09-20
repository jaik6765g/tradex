import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  LOTTO_ROUND_ENGINE_QUEUE,
  LOTTO_ROUND_ENGINE_TICK_JOB,
  LOTTO_ROUND_ENGINE_REPEAT_JOB_ID,
} from './lotto-round-engine.queue';
import { runStartupTask } from '../../../common/utils/startup-retry';

@Injectable()
export class LottoRoundEngineScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LottoRoundEngineScheduler.name);

  constructor(
    @InjectQueue(LOTTO_ROUND_ENGINE_QUEUE)
    private readonly lottoRoundEngineQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  // Deferred + retried (cold-start safety): a Redis hiccup at boot must
  // never block or crash HTTP startup. Registration retries in the
  // background and gives up after bounded attempts; queues and workers are
  // unaffected either way.
  onApplicationBootstrap(): void {
    if (!this.isRoundEngineEnabled()) {
      this.logger.log('Lotto round engine scheduler disabled by config');
      return;
    }

    const intervalMs = this.getRoundEngineIntervalMs();

    void runStartupTask({
      name: 'LottoRoundEngineScheduler.upsertJobScheduler',
      logger: this.logger,
      task: async () => {
        await this.lottoRoundEngineQueue.upsertJobScheduler(
          LOTTO_ROUND_ENGINE_REPEAT_JOB_ID,
          {
            every: intervalMs,
          },
          {
            name: LOTTO_ROUND_ENGINE_TICK_JOB,
            data: {},
            opts: {
              removeOnComplete: 100,
              removeOnFail: 500,
            },
          },
        );

        this.logger.log(
          `Lotto round engine scheduler started (interval: ${intervalMs}ms)`,
        );
      },
    });
  }

  private isRoundEngineEnabled(): boolean {
    const raw = (
      this.configService.get<string>('LOTTO_ROUND_ENGINE_ENABLED') ?? 'true'
    ).trim();
    return !['0', 'false', 'off', 'no'].includes(raw.toLowerCase());
  }

  private getRoundEngineIntervalMs(): number {
    const raw =
      this.configService.get<string>('LOTTO_ROUND_ENGINE_INTERVAL_MS') ?? '1000';
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 250) {
      return 1000;
    }
    return parsed;
  }
}