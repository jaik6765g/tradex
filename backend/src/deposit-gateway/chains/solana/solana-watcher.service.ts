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
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { SolanaDepositAdapter } from './solana-deposit-adapter';

export const SOLANA_DETECTION_QUEUE = 'solana-deposit-detection';

/**
 * Watches confirmed SPL USDT transfers to TradeX Solana deposit addresses.
 *
 * Solana model: the deposit address is the OWNER of a SPL token account; the
 * token account (not the address) receives USDT. So per address the watcher
 * resolves its USDT token account, then scans that token account's signatures.
 * Recipient identity comes from token-account ownership — never the sender.
 *
 * Cursor is persisted in gateway_watcher_state (slots); on restart the watcher
 * resumes from the persisted slot with a bounded overlap so straggler
 * transactions near the cursor are re-scanned. Recent signatures are
 * re-scanned each cycle and deduplicated by:
 *   - deterministic BullMQ job ids (DB-side, survive restarts/multi-instance),
 *   - the deposit tx-hash UNIQUE constraint,
 *   - an in-memory Set for same-process dedup.
 *
 * Multiple backend instances cannot create duplicate financial processing
 * because BullMQ job ids are deterministic and the deposit tx-hash UNIQUE
 * constraint is the final guard — the in-memory Set is only an optimization.
 */
@Injectable()
export class SolanaWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolanaWatcherService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private readonly queued = new Set<string>();
  private readonly tokenAccountCache = new Map<string, { value: string[]; at: number }>();
  private lastScanAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private lastProcessedSlot: number | null = null;
  private consecutiveErrors = 0;

  /** Slot overlap on restart to catch stragglers near the cursor. */
  private readonly SLOT_OVERLAP = 100;

  constructor(
    @InjectRepository(GatewayWatcherState)
    private readonly stateRepo: Repository<GatewayWatcherState>,
    private readonly addressService: DepositAddressService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    @InjectQueue(SOLANA_DETECTION_QUEUE)
    private readonly detectionQueue: Queue,
  ) {}

  onModuleInit(): void {
    const network = this.networkRegistry.getNetwork('solana');
    if (!network.configured || !network.watcherEnabled) {
      this.logger.warn('SOLANA deposit watcher disabled: not configured/enabled');
      return;
    }
    this.intervalHandle = setInterval(() => void this.scan(), this.intervalMs());
    this.logger.log('SOLANA deposit watcher started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private intervalMs(): number {
    return Number(this.configService.get<string>('SOLANA_SCAN_INTERVAL') ?? '60000');
  }

  /**
   * Load the persisted slot cursor for restart recovery.
   * Returns 0 when no cursor exists yet (first run).
   */
  private async loadPersistedSlot(): Promise<number> {
    const state = await this.stateRepo.findOne({
      where: { chainId: SOLANA_CHAIN_ID },
    });
    return Number(state?.lastProcessedBlock ?? 0);
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.lastScanAt = Date.now();
    try {
      const network = this.networkRegistry.getNetwork('solana');
      if (!network.configured || !network.watcherEnabled) return;

      const adapter = new SolanaDepositAdapter(network);
      const addresses = await this.addressService.findActiveByChain(SOLANA_CHAIN_ID);
      if (addresses.length === 0) return;

      // Restart recovery: resume from persisted slot with overlap for stragglers.
      const persistedSlot = await this.loadPersistedSlot();
      const beforeSlot = persistedSlot > 0 ? persistedSlot + this.SLOT_OVERLAP : undefined;

      const signatures = new Set<string>();
      let maxSlotSeen = persistedSlot;

      for (const addr of addresses) {
        try {
          const tokenAccounts = await this.resolveTokenAccount(
            adapter,
            addr.address,
            network.usdtContract,
          );
          if (tokenAccounts.length === 0) continue;

          // Scan the primary token account. Multiple accounts per address
          // are handled by reconciliation; the watcher uses the primary for detection.
          const sigs = await adapter.getSignaturesForAddress(
            tokenAccounts[0],
            200,
            beforeSlot,
          );
          for (const sig of sigs) {
            const signature =
              typeof sig === 'string' ? sig : (sig?.signature as string | undefined);
            const slot = typeof sig === 'object' && sig != null ? Number(sig.slot ?? 0) : 0;
            if (typeof signature === 'string' && signature) {
              signatures.add(signature);
              if (slot > 0) maxSlotSeen = Math.max(maxSlotSeen, slot);
            }
          }
        } catch (error) {
          this.logger.warn(
            `SOLANA signature scan failed for ${addr.address}: ${(error as Error).message}`,
          );
          continue; // per-address isolation — the watcher continues
        }
      }

      for (const signature of signatures) {
        await this.enqueue(signature);
      }

      // Only advance the cursor when we actually processed signatures.
      // This prevents the cursor from racing ahead past unprocessed transactions.
      if (maxSlotSeen > persistedSlot) {
        await this.stateRepo.upsert(
          {
            chainId: SOLANA_CHAIN_ID,
            lastProcessedBlock: maxSlotSeen,
            lastProcessedTimestamp: null,
          },
          ['chainId'],
        );
        this.lastProcessedSlot = maxSlotSeen;
      }

      this.consecutiveErrors = 0;
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.warn(
        `SOLANA watcher scan error (consecutive=${this.consecutiveErrors}): ${(error as Error).message}`,
      );
      this.lastErrorAt = Date.now();
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.scanning = false;
    }
  }

  private async resolveTokenAccount(
    adapter: SolanaDepositAdapter,
    owner: string,
    mint: string,
  ): Promise<string[]> {
    const cached = this.tokenAccountCache.get(owner);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const value = await adapter.getTokenAccountsByOwner(owner, mint);
    this.tokenAccountCache.set(owner, { value, at: Date.now() });
    return value;
  }

  private async enqueue(signature: string): Promise<void> {
    const key = signature.toLowerCase();
    if (this.queued.has(key)) return;
    this.queued.add(key);
    try {
      await this.detectionQueue.add(
        'detect-solana-deposit',
        {
          chainId: SOLANA_CHAIN_ID,
          signature,
          detectedAt: new Date().toISOString(),
        },
        {
          jobId: `solana-${key}`,
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

  /** Safe runtime status (never exposes keys/secrets). */
  status(): {
    running: boolean;
    lastScanAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
    lastProcessedSlot: number | null;
    consecutiveErrors: number;
  } {
    return {
      running: this.intervalHandle !== null,
      lastScanAt: this.lastScanAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      lastProcessedSlot: this.lastProcessedSlot,
      consecutiveErrors: this.consecutiveErrors,
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
        pending: Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0),
        failed: Number(counts.failed ?? 0),
        active: Number(counts.active ?? 0),
      };
    } catch {
      return { pending: -1, failed: -1, active: -1 };
    }
  }
}