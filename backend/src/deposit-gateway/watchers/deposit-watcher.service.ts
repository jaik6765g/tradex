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

import { GatewayWatcherState } from './gateway-watcher-state.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { ChainRegistryService } from '../chains/chain-registry.service';
import { GATEWAY_DETECTION_QUEUE } from '../processors/gateway-deposit-detection.processor';

/**
 * Watches USDT Transfer events whose RECIPIENT is a TradeX-assigned deposit
 * address. Replaces the legacy "sender-wallet -> user" mapping: the sender is
 * informational and can be any external wallet/exchange. Last-processed block
 * is persisted in PostgreSQL so the watcher resumes safely after restart.
 */
@Injectable()
export class DepositWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositWatcherService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private readonly queued = new Set<string>();
  /** Per-chain runtime observability (safe values only — additive, Phase 7.1). */
  private readonly chainStatus = new Map<
    number,
    { lastScanAt: number | null; lastErrorAt: number | null; lastError: string | null }
  >();

  constructor(
    @InjectRepository(GatewayWatcherState)
    private readonly stateRepo: Repository<GatewayWatcherState>,
    private readonly addressService: DepositAddressService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly configService: ConfigService,
    @InjectQueue(GATEWAY_DETECTION_QUEUE)
    private readonly detectionQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedStates();
    this.intervalHandle = setInterval(() => void this.scan(), this.intervalMs());
    this.logger.log('Deposit gateway watcher started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Safe runtime status (never exposes keys/secrets). */
  status(): {
    running: boolean;
    chains: Array<{
      chainId: number;
      lastScanAt: number | null;
      lastErrorAt: number | null;
      lastError: string | null;
    }>;
  } {
    return {
      running: this.intervalHandle !== null,
      chains: [...this.chainStatus.entries()].map(([chainId, s]) => ({
        chainId,
        lastScanAt: s.lastScanAt,
        lastErrorAt: s.lastErrorAt,
        lastError: s.lastError,
      })),
    };
  }

  /** BullMQ detection-queue health (best-effort; -1 when unavailable). */
  async queueHealth(): Promise<{ pending: number; failed: number; active: number }> {
    try {
      const counts = await this.detectionQueue.getJobCounts(
        'waiting',
        'delayed',
        'failed',
        'active',
      );
      return {
        pending: Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0),
        failed: Number(counts.failed ?? 0),
        active: Number(counts.active ?? 0),
      };
    } catch {
      return { pending: -1, failed: -1, active: -1 };
    }
  }

  private intervalMs(): number {
    return Number(this.configService.get<string>('BSC_SCAN_INTERVAL') ?? '60000');
  }

  private maxBlocks(): number {
    const n = Number(this.configService.get<string>('BSC_MAX_BLOCKS_PER_SCAN') ?? '10');
    return Math.max(1, Math.min(n, 10));
  }

  private async seedStates(): Promise<void> {
    for (const chain of this.chainRegistry.listChains()) {
      try {
        const existing = await this.stateRepo.findOne({
          where: { chainId: chain.chainId },
        });
        if (existing) continue;
        const adapter = this.chainRegistry.getAdapter(chain.chainId);
        const current = await adapter.getCurrentBlock();
        await this.stateRepo.save({
          chainId: chain.chainId,
          lastProcessedBlock: Math.max(0, current - 100),
        });
      } catch (error) {
        this.logger.warn(
          `Unable to seed watcher state for chain ${chain.chainId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const chain of this.chainRegistry.listChains()) {
        try {
          await this.scanChain(chain.chainId);
          const s = this.chainStatus.get(chain.chainId) ?? {
            lastScanAt: null,
            lastErrorAt: null,
            lastError: null,
          };
          s.lastScanAt = Date.now();
          this.chainStatus.set(chain.chainId, s);
        } catch (error) {
          this.logger.warn(
            `Watcher scan failed for chain ${chain.chainId}: ${(error as Error).message}`,
          );
          const s = this.chainStatus.get(chain.chainId) ?? {
            lastScanAt: null,
            lastErrorAt: null,
            lastError: null,
          };
          s.lastErrorAt = Date.now();
          s.lastError = error instanceof Error ? error.message : String(error);
          this.chainStatus.set(chain.chainId, s);
          // per-chain isolation: Polygon failure never stops Arbitrum (and vice versa)
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private async scanChain(chainId: number): Promise<void> {
    const adapter = this.chainRegistry.getAdapter(chainId);
    const tokenAddress = adapter.getTokenAddress('USDT');
    const current = await adapter.getCurrentBlock();

    let state = await this.stateRepo.findOne({ where: { chainId } });
    if (!state) {
      await this.seedStates();
      state = await this.stateRepo.findOne({ where: { chainId } });
    }
    if (!state || state.lastProcessedBlock >= current) return;

    const addresses = await this.addressService.findActiveByChain(chainId);
    const recipients = addresses.map((a) => a.address);

    if (recipients.length === 0) {
      await this.stateRepo.save({ chainId, lastProcessedBlock: current });
      return;
    }

    let from = state.lastProcessedBlock + 1;
    const max = this.maxBlocks();

    while (from <= current) {
      const to = Math.min(from + max - 1, current);
      let logs;
      try {
        logs = await adapter.getTransferLogs(tokenAddress, from, to, recipients);
      } catch (error) {
        this.logger.warn(`getLogs failed ${from}→${to}: ${(error as Error).message}`);
        return;
      }
      for (const log of logs) {
        await this.enqueue(chainId, log);
      }
      await this.stateRepo.save({ chainId, lastProcessedBlock: to });
      from = to + 1;
    }
  }

  private async enqueue(
    chainId: number,
    log: {
      transactionHash: string;
      blockNumber: number;
      logIndex: number;
      from: string;
      to: string;
      amount: string;
      tokenAddress: string;
    },
  ): Promise<void> {
    const key = `${chainId}:${log.transactionHash}:${log.logIndex}`.toLowerCase();
    if (this.queued.has(key)) return;
    this.queued.add(key);

    try {
      await this.detectionQueue.add(
        'detect-gateway-deposit',
        {
          chainId,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          from: log.from,
          to: log.to,
          amount: log.amount,
          tokenAddress: log.tokenAddress,
          detectedAt: new Date().toISOString(),
        },
        {
          jobId: `gateway-${log.transactionHash.toLowerCase()}-${log.logIndex}`,
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
