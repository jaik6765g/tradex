import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  DepositSweepService,
  SWEEP_CONFIRMATION_QUEUE,
} from './deposit-sweep.service';

@Processor(SWEEP_CONFIRMATION_QUEUE)
@Injectable()
export class DepositSweepConfirmationProcessor extends WorkerHost {
  constructor(private readonly sweepService: DepositSweepService) {
    super();
  }

  async process(job: Job<{ sweepId: string }>): Promise<void> {
    await this.sweepService.confirmSweep(job.data.sweepId);
  }
}
