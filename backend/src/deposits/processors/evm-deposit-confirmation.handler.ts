import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';

import { DepositService } from '../../deposits/deposit.service';
import { DepositStatus } from '../../deposits/deposit.entity';
import { NetworkRegistryService } from '../../deposit-gateway/networks/network-registry.service';
import { EvmDepositAdapter } from '../../deposit-gateway/chains/evm/evm-deposit-adapter';
import {
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
} from '../../deposit-gateway/config/networks.config';

/**
 * Chain ids served by the GENERIC EVM confirmation engine (Phase 7.1).
 *
 * Scope note: Polygon + Arbitrum ONLY. Other EVM networks (Ethereum,
 * Optimism, Avalanche, Base) intentionally keep their current behavior
 * (not routed here) so this phase cannot regress them. BSC keeps its
 * dedicated BSC-specific confirmation path, byte-for-byte unchanged.
 * Extending this list is an explicit later-phase decision.
 */
export const EVM_CONFIRMATION_SUPPORTED_CHAINS: ReadonlySet<number> = new Set([
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
]);

/**
 * Generic, chain-aware EVM deposit confirmation engine.
 *
 * Reuses the SAME generic EVM architecture as detection (NetworkRegistry + the
 * shared EvmDepositAdapter) — no per-network confirmation values are hardcoded:
 * the requirement is the network's configured `confirmations` (persisted on the
 * deposit at detection time as `requiredConfirmations`).
 *
 * Safety rules:
 * - Confirmation is ALWAYS recomputed from the chain on every poll — a stored
 *   confirmation count is never trusted.
 * - No credit is enqueued before the configured threshold is reached.
 * - Reverted tx → deposit FAILED (no credit).
 * - Missing receipt → throw (BullMQ retries; nothing is mutated).
 * - Duplicate/late jobs are safe: terminal-status short-circuit + deterministic
 *   credit job id (`evm-credit-<depositId>`) + ledger reference idempotency.
 */
@Injectable()
export class EvmDepositConfirmationHandler {
  private readonly logger = new Logger(EvmDepositConfirmationHandler.name);
  private readonly networkRegistry: NetworkRegistryService;
  private readonly adapters = new Map<number, EvmDepositAdapter>();

  constructor(
    private readonly depositService: DepositService,
    private readonly configService: ConfigService,
    @InjectQueue('deposit-confirmation')
    private readonly confirmationQueue: Queue,
  ) {
    // Stateless registry (ConfigService only) — safe to construct directly so
    // the deposits module needs no dependency on the gateway module.
    this.networkRegistry = new NetworkRegistryService(configService);
  }

  isSupportedChain(chainId: number): boolean {
    return EVM_CONFIRMATION_SUPPORTED_CHAINS.has(chainId);
  }

  private adapterFor(chainId: number): EvmDepositAdapter {
    const cached = this.adapters.get(chainId);
    if (cached) return cached;

    const network = this.networkRegistry.getNetworkByChainId(chainId);
    if (!network || network.protocol !== 'EVM' || !network.configured) {
      throw new Error(
        `EVM network ${chainId} is not configured — confirmation cannot proceed`,
      );
    }
    const adapter = new EvmDepositAdapter(network);
    this.adapters.set(chainId, adapter);
    return adapter;
  }

  async handle(job: Job): Promise<void> {
    const { depositId, transactionHash, chainId } = job.data as {
      depositId: string;
      transactionHash: string;
      chainId: number;
    };

    const deposit = await this.depositService.getDepositById(depositId);
    if (
      !deposit ||
      deposit.status === DepositStatus.COMPLETED ||
      deposit.status === DepositStatus.FAILED
    ) {
      return; // terminal / unknown → nothing to do (idempotent)
    }
    if (deposit.chainId !== chainId) {
      // Cross-network safety: never confirm a deposit against another chain's tx.
      this.logger.warn(
        `Confirmation skipped for ${transactionHash}: chain mismatch (payload=${chainId}, deposit=${deposit.chainId})`,
      );
      return;
    }

    const adapter = this.adapterFor(chainId);

    const receipt = await adapter.getTransactionReceipt(transactionHash);
    if (!receipt) {
      // Not indexed yet (or RPC hiccup) → retry via BullMQ; nothing mutated.
      throw new Error('Transaction receipt not found');
    }
    if (receipt.status !== 1) {
      this.logger.warn(
        `EVM deposit reverted: ${transactionHash} (chain ${chainId})`,
      );
      await this.depositService.updateDepositStatus(
        depositId,
        DepositStatus.FAILED,
        'Transaction reverted on-chain',
      );
      return;
    }

    // Recompute confirmations from the chain on EVERY poll.
    const confirmations = await adapter.getConfirmations(receipt.blockNumber);
    await this.depositService.updateConfirmations(depositId, confirmations);

    if (confirmations >= deposit.requiredConfirmations) {
      const refreshed = await this.depositService.getDepositById(depositId);
      if (!refreshed || refreshed.status !== DepositStatus.VERIFIED) {
        return; // status changed underneath — skip (no credit outside VERIFIED)
      }
      await this.confirmationQueue.add(
        'credit-deposit',
        { depositId: refreshed.id, userId: refreshed.userId },
        {
          jobId: `evm-credit-${refreshed.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } else {
      // Below threshold → schedule the next poll. No jobId: a duplicate jobId
      // matching the ACTIVE job is dropped by BullMQ, which would stall polling.
      await this.confirmationQueue.add(
        'confirm-deposit',
        { depositId, transactionHash, chainId },
        {
          delay: 30000,
          attempts: 20,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
  }
}