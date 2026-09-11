import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import {
  PULSE_SETTLEMENT_QUEUE,
  PULSE_SETTLEMENT_SCAN_JOB,
  PULSE_SETTLEMENT_SCAN_REPEAT_JOB_ID,
} from './pulse-settlement.queue';

@Injectable()
export class PulseSettlementScheduler implements OnModuleInit {
  private readonly logger = new Logger(PulseSettlementScheduler.name);

  constructor(
    @InjectQueue(PULSE_SETTLEMENT_QUEUE)
    private readonly pulseSettlementQueue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isExpirySettlementEnabled()) {
      this.logger.log('Pulse settlement queue scheduler disabled by config');
      return;
    }

    const intervalMs = this.getExpirySettlementIntervalMs();

    await this.pulseSettlementQueue.upsertJobScheduler(
      PULSE_SETTLEMENT_SCAN_REPEAT_JOB_ID,
      {
        every: intervalMs,
      },
      {
        name: PULSE_SETTLEMENT_SCAN_JOB,
        data: {},
        opts: {
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      },
    );

    this.logger.log(
      `Pulse settlement queue scheduler started (interval: ${intervalMs}ms)`,
    );
  }

  private isExpirySettlementEnabled(): boolean {
    const raw = (
      this.configService.get<string>('PULSE_EXPIRY_SETTLEMENT_ENABLED') ??
      'true'
    ).trim();
    return !['0', 'false', 'off', 'no'].includes(raw.toLowerCase());
  }

  private getExpirySettlementIntervalMs(): number {
    const raw =
      this.configService.get<string>('PULSE_EXPIRY_SETTLEMENT_INTERVAL_MS') ??
      '1000';
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 250) {
      return 1000;
    }
    return parsed;
  }
}
