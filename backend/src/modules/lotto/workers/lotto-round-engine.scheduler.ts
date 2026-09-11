import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  LOTTO_ROUND_ENGINE_QUEUE,
  LOTTO_ROUND_ENGINE_TICK_JOB,
  LOTTO_ROUND_ENGINE_REPEAT_JOB_ID,
} from './lotto-round-engine.queue';

@Injectable()
export class LottoRoundEngineScheduler implements OnModuleInit {
  private readonly logger = new Logger(LottoRoundEngineScheduler.name);

  constructor(
    @InjectQueue(LOTTO_ROUND_ENGINE_QUEUE)
    private readonly lottoRoundEngineQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isRoundEngineEnabled()) {
      this.logger.log('Lotto round engine scheduler disabled by config');
      return;
    }

    const intervalMs = this.getRoundEngineIntervalMs();

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