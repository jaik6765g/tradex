import { Injectable, Logger } from '@nestjs/common';
import { WageringService } from './wagering.service';

/**
 * Periodic reconciliation sweep for missed deposit obligations. Deposit
 * crediting stays non-blocking; this processor is the reliable repair path.
 * Uses a plain setInterval-style loop (no extra scheduler dependency), only
 * acts when the service reports work, and never throws.
 */
@Injectable()
export class WageringReconciliationProcessor {
  private readonly logger = new Logger(WageringReconciliationProcessor.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly wageringService: WageringService) {}

  start(intervalMs = 600_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    // Do not keep the process alive purely for reconciliation.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.wageringService.reconcileDepositObligations(null);
      if (result.created > 0) {
        this.logger.log(
          `Wagering reconciliation: scanned=${result.scanned} created=${result.created} skipped=${result.skipped}`,
        );
      }
      const eventResult = await this.wageringService.reconcileWageringEvents(null);
      if (eventResult.counted > 0) {
        this.logger.log(
          `Wagering event reconciliation: scanned=${eventResult.scanned} counted=${eventResult.counted} skipped=${eventResult.skipped}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Wagering reconciliation failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}