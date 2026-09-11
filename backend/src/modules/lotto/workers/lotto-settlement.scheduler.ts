import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  LOTTO_SETTLEMENT_QUEUE,
  LOTTO_SETTLEMENT_SCAN_JOB,
  LOTTO_SETTLEMENT_SCAN_REPEAT_JOB_ID,
} from './lotto-settlement.queue';

@Injectable()
export class LottoSettlementScheduler implements OnModuleInit {
  private readonly logger = new Logger(LottoSettlementScheduler.name);

  constructor(
    @InjectQueue(LOTTO_SETTLEMENT_QUEUE)
    private readonly lottoSettlementQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isExpirySettlementEnabled()) {
      this.logger.log('Lotto settlement queue scheduler disabled by config');
      return;
    }

    const intervalMs = this.getExpirySettlementIntervalMs();

    await this.lottoSettlementQueue.upsertJobScheduler(
      LOTTO_SETTLEMENT_SCAN_REPEAT_JOB_ID,
      {
        every: intervalMs,
      },
      {
        name: LOTTO_SETTLEMENT_SCAN_JOB,
        data: {},
        opts: {
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      },
    );

    this.logger.log(
      `Lotto settlement queue scheduler started (interval: ${intervalMs}ms)`,
    );
  }

  private isExpirySettlementEnabled(): boolean {
    const raw = (
      this.configService.get<string>('LOTTO_EXPIRY_SETTLEMENT_ENABLED') ??
      'true'
    ).trim();
    return !['0', 'false', 'off', 'no'].includes(raw.toLowerCase());
  }

  private getExpirySettlementIntervalMs(): number {
    const raw =
      this.configService.get<string>('LOTTO_EXPIRY_SETTLEMENT_INTERVAL_MS') ??
      '1000';
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 250) {
      return 1000;
    }
    return parsed;
  }
}
