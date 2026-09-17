import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { GatewayWatcherState } from '../../watchers/gateway-watcher-state.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import {
  TronDepositAdapter,
  type TronTrc20Transfer,
} from './tron-deposit-adapter';
import { TRON_DETECTION_QUEUE } from '../../processors/tron-deposit-detection.processor';

/**
 * Watches TRC-20 USDT transfers whose RECIPIENT is a TradeX-assigned TRON
 * deposit address. Sender never identifies the user. The timestamp cursor is
 * persisted in gateway_watcher_state (TRON TronGrid paginates by ms). RPC
 * failures are isolated per cycle so a TRON outage cannot crash the gateway.
 */
@Injectable()
export class TronWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TronWatcherService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private readonly queued = new Set<string>();
  private lastScanAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;

  constructor(
    @InjectRepository(GatewayWatcherState)
    private readonly stateRepo: Repository<GatewayWatcherState>,
    private readonly addressService: DepositAddressService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    @InjectQueue(TRON_DETECTION_QUEUE)
    private readonly detectionQueue: Queue,
  ) {}

  onModuleInit(): void {
    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured || !network.watcherEnabled) {
      this.logger.warn('TRON deposit watcher disabled: not configured/enabled');
      return;
    }
    this.intervalHandle = setInterval(() => void this.scan(), this.intervalMs());
    this.logger.log('TRON deposit watcher started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private intervalMs(): number {
    return Number(this.configService.get<string>('TRON_SCAN_INTERVAL') ?? '60000');
  }

  private tronApiKey(): string | undefined {
    return this.configService.get<string>('TRON_GRID_API_KEY')?.trim() || undefined;
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.lastScanAt = Date.now();
    try {
      const network = this.networkRegistry.getNetwork('tron');
      if (!network.configured || !network.watcherEnabled) return;

      const adapter = new TronDepositAdapter(
        network,
        globalThis.fetch,
        this.tronApiKey(),
      );
      const addresses = await this.addressService.findActiveByChain(TRON_CHAIN_ID);
      if (addresses.length === 0) return;

      const state = await this.stateRepo.findOne({
        where: { chainId: TRON_CHAIN_ID },
      });
      const cursor = Number(state?.lastProcessedTimestamp ?? 0);
      const overlapMs = 60 * 60 * 1000; // 1h overlap to catch stragglers
      const minTimestamp = Math.max(0, cursor - overlapMs);

      let maxTimestamp = cursor;
      for (const addr of addresses) {
        let transfers: TronTrc20Transfer[];
        try {
          transfers = await adapter.getAllTrc20Transfers(addr.address, {
            minTimestamp,
          });
        } catch (error) {
          this.logger.warn(
            `TRON transfer fetch failed for ${addr.address}: ${(error as Error).message}`,
          );
          continue;
        }

        for (const t of transfers) {
          maxTimestamp = Math.max(maxTimestamp, t.blockTimestamp);
          await this.enqueue(t, addr.address);
        }
      }

      if (maxTimestamp > cursor) {
        await this.stateRepo.upsert(
          {
            chainId: TRON_CHAIN_ID,
            lastProcessedBlock: 0,
            lastProcessedTimestamp: maxTimestamp,
          },
          ['chainId'],
        );
      }
    } catch (error) {
      this.logger.warn(`TRON watcher scan error: ${(error as Error).message}`);
      this.lastErrorAt = Date.now();
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.scanning = false;
    }
  }

  /** Safe runtime status (never exposes keys/secrets). */
  status(): {
    running: boolean;
    lastScanAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
  } {
    return {
      running: this.intervalHandle !== null,
      lastScanAt: this.lastScanAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  /** BullMQ queue health (best-effort; -1 when unavailable). */
  async queueHealth(): Promise<{ pending: number; failed: number; active: number }> {
    try {
      const counts = await this.detectionQueue.getJobCounts(
        'waiting',
        'delayed',
        'failed',
        'active',
      );
      return {
        pending:
          Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0),
        failed: Number(counts.failed ?? 0),
        active: Number(counts.active ?? 0),
      };
    } catch {
      return { pending: -1, failed: -1, active: -1 };
    }
  }

  private async enqueue(t: TronTrc20Transfer, recipient: string): Promise<void> {
    const key = t.txId.toLowerCase();
    if (this.queued.has(key)) return;
    this.queued.add(key);

    try {
      await this.detectionQueue.add(
        'detect-tron-transfer',
        {
          txId: t.txId,
          recipient,
          from: t.from,
          amountRaw: t.amountRaw,
          tokenAddress: t.tokenAddress,
          blockTimestamp: t.blockTimestamp,
          detectedAt: new Date().toISOString(),
        },
        {
          jobId: `tron-${t.txId}`,
          attempts: 12,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      this.queued.delete(key);
      throw error;
    }
  }
}
