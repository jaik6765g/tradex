import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { Deposit, DepositStatus } from '../../deposits/deposit.entity';
import { DepositOrderStatus } from '../orders/deposit-order.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { DepositOrderService } from '../orders/deposit-order.service';
import { ChainRegistryService } from '../chains/chain-registry.service';
import { GATEWAY_DETECTION_QUEUE } from '../processors/gateway-deposit-detection.processor';
import { TRON_DETECTION_QUEUE } from '../processors/tron-deposit-detection.processor';
import { NetworkRegistryService } from '../networks/network-registry.service';
import { TronDepositAdapter } from '../chains/tron/tron-deposit-adapter';
import { DepositSweepService } from '../sweeps/deposit-sweep.service';

const RESCANNED_STATUSES = [
  DepositOrderStatus.AWAITING_PAYMENT,
  DepositOrderStatus.DETECTED,
  DepositOrderStatus.CONFIRMING,
];

@Injectable()
export class DepositReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DepositReconciliationService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private reconciling = false;

  constructor(
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    private readonly orderService: DepositOrderService,
    private readonly addressService: DepositAddressService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly sweepService: DepositSweepService,
    @InjectQueue(GATEWAY_DETECTION_QUEUE)
    private readonly detectionQueue: Queue,
    @InjectQueue(TRON_DETECTION_QUEUE)
    private readonly tronQueue: Queue,
  ) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => void this.reconcile(), 5 * 60_000);
    this.logger.log('Deposit reconciliation started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.expireStaleOrders();
      await this.syncOrderStatusFromDeposits();
      await this.rescanActiveOrders();
      await this.sweepService.scheduleDueSweeps();
    } catch (error) {
      this.logger.error(`Reconciliation error: ${(error as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async expireStaleOrders(): Promise<void> {
    const stale = await this.orderService.listExpireable(new Date());
    for (const order of stale) {
      // Never expire the user's shared network address — only the order slip.
      await this.orderService.updateStatus(order.id, DepositOrderStatus.EXPIRED);
    }
  }

  private async syncOrderStatusFromDeposits(): Promise<void> {
    const orders = await this.orderService.listNonTerminal();
    for (const order of orders) {
      const deposit = await this.depositRepo.findOne({
        where: { orderId: order.id },
      });
      if (!deposit) continue;

      let next: string | null = null;
      if (deposit.status === DepositStatus.COMPLETED) {
        next = DepositOrderStatus.COMPLETED;
      } else if (deposit.status === DepositStatus.FAILED) {
        next = DepositOrderStatus.FAILED;
      } else if (deposit.status === DepositStatus.VERIFIED) {
        next = DepositOrderStatus.CONFIRMED;
      } else if (deposit.status === DepositStatus.PENDING) {
        next = DepositOrderStatus.DETECTED;
      }

      if (next && next !== order.status) {
        await this.orderService.updateStatus(order.id, next);
      }
    }
  }

  private async rescanActiveOrders(): Promise<void> {
    const orders = await this.orderService.listNonTerminal();
    const byChain = new Map<number, string[]>();

    for (const order of orders) {
      if (!RESCANNED_STATUSES.includes(order.status as DepositOrderStatus)) {
        continue;
      }
      const existing = await this.depositRepo.findOne({
        where: { orderId: order.id },
      });
      if (existing) continue;

      const address = order.depositAddressId
        ? await this.addressService.findById(order.depositAddressId)
        : null;
      if (!address) continue;

      const list = byChain.get(order.chainId) ?? [];
      list.push(address.address);
      byChain.set(order.chainId, list);
    }

    for (const [chainId, addresses] of byChain.entries()) {
      const network = this.networkRegistry.getNetworkByChainId(chainId);
      if (!network) continue;

      // TRON has no EVM adapter / getLogs path — use its own adapter.
      if (network.protocol === 'TRON') {
        await this.rescanTron([...new Set(addresses)]);
        continue;
      }

      const adapter = this.chainRegistry.getAdapter(chainId);
      const tokenAddress = adapter.getTokenAddress('USDT');
      const current = await adapter.getCurrentBlock();
      const from = Math.max(0, current - 500);

      let logs;
      try {
        logs = await adapter.getTransferLogs(tokenAddress, from, current, [
          ...new Set(addresses),
        ]);
      } catch (error) {
        this.logger.warn(
          `Reconciliation rescan failed (chain ${chainId}): ${(error as Error).message}`,
        );
        continue;
      }

      for (const log of logs) {
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
      }
    }
  }

  private async rescanTron(addresses: string[]): Promise<void> {
    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured) return;

    const adapter = new TronDepositAdapter(network);
    const since = Date.now() - 24 * 60 * 60 * 1000; // 24h rescan window

    for (const address of addresses) {
      let transfers;
      try {
        transfers = await adapter.getTrc20Transfers(address, {
          minTimestamp: since,
        });
      } catch (error) {
        this.logger.warn(
          `TRON reconciliation rescan failed (${address}): ${(error as Error).message}`,
        );
        continue;
      }

      for (const t of transfers) {
        await this.tronQueue.add(
          'detect-tron-transfer',
          {
            txId: t.txId,
            recipient: address,
            from: t.from,
            amountRaw: t.amountRaw,
            tokenAddress: t.tokenAddress,
            blockTimestamp: t.blockTimestamp,
            detectedAt: new Date().toISOString(),
          },
          {
            jobId: `tron-recon-${t.txId}`,
            attempts: 12,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }
    }
  }
}
