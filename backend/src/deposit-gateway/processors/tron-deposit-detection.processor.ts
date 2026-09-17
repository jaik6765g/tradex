import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';

import { DepositService } from '../../deposits/deposit.service';
import { DepositStatus } from '../../deposits/deposit.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { TokenRegistryService } from '../tokens/token-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../config/networks.config';
import {
  TronDepositAdapter,
  formatTdxUnits,
  formatUsdtUnits,
} from '../chains/tron/tron-deposit-adapter';

export const TRON_DETECTION_QUEUE = 'gateway-tron-detection';

interface TronDetectJobData {
  txId: string;
  recipient: string;
  from: string;
  amountRaw: string;
  tokenAddress: string;
  blockTimestamp: number;
}

@Processor(TRON_DETECTION_QUEUE)
@Injectable()
export class TronDepositDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(TronDepositDetectionProcessor.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly addressService: DepositAddressService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    @InjectQueue(TRON_DETECTION_QUEUE)
    private readonly tronQueue: Queue,
    @InjectQueue('deposit-confirmation')
    private readonly confirmationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'detect-tron-transfer') {
      await this.detect(job);
      return;
    }
    if (job.name === 'confirm-tron-deposit') {
      await this.confirm(job);
      return;
    }
  }

  private adapter(): TronDepositAdapter {
    const apiKey = this.configService.get<string>('TRON_GRID_API_KEY')?.trim() || undefined;
    return new TronDepositAdapter(this.networkRegistry.getNetwork('tron'), globalThis.fetch, apiKey);
  }

  private async detect(job: Job<TronDetectJobData>): Promise<void> {
    const data = job.data;
    const network = this.networkRegistry.getNetwork('tron');
    const adapter = this.adapter();

    if (data.tokenAddress !== network.usdtContract) {
      this.logger.warn(`Rejecting ${data.txId}: token mismatch`);
      return;
    }

    const depositAddress = await this.addressService.findByAddressAndChainId(
      data.recipient,
      TRON_CHAIN_ID,
    );
    if (!depositAddress || !depositAddress.userId) {
      this.logger.warn(`Ignoring ${data.txId}: recipient not an assigned TRON address`);
      return;
    }
    const userId = depositAddress.userId;

    const receivedRaw = BigInt(data.amountRaw);
    if (receivedRaw <= 0n) {
      this.logger.warn(`Ignoring ${data.txId}: zero amount`);
      return;
    }

    const token = this.tokenRegistry.getToken('USDT', TRON_CHAIN_ID);
    const txInfo = await adapter.getTransactionInfo(data.txId);
    if (!txInfo.success) {
      this.logger.warn(`Rejecting ${data.txId}: TRON tx failed`);
      return;
    }

    const currentBlock = await adapter.getCurrentBlock();
    const confirmations = Math.max(0, currentBlock - txInfo.blockNumber + 1);

    const usdtAmount = formatUsdtUnits(data.amountRaw, token.decimals);
    const tdxAmount = formatTdxUnits(data.amountRaw, token.decimals, token.tdxRate);

    let deposit;
    try {
      deposit = await this.depositService.createDeposit({
        userId,
        walletId: null,
        orderId: depositAddress.orderId ?? null,
        depositAddress: data.recipient,
        chainId: TRON_CHAIN_ID,
        transactionHash: data.txId,
        blockNumber: txInfo.blockNumber,
        blockTimestamp: new Date(data.blockTimestamp || 0),
        vaultAddress: data.recipient,
        senderAddress: data.from,
        amount: data.amountRaw,
        usdtAmount,
        tdxAmount,
        confirmations,
        requiredConfirmations: network.confirmations,
      });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      if (e?.status === 409 || e?.message?.includes('already processed')) {
        this.logger.warn(`Duplicate TRON detection for ${data.txId}`);
        return;
      }
      throw error;
    }

    if (confirmations >= network.confirmations) {
      await this.depositService.updateConfirmations(deposit.id, confirmations);
      await this.enqueueCredit(deposit.id, userId);
    } else {
      await this.enqueueConfirm(deposit.id, data.txId);
    }
  }

  private async confirm(job: Job<{ depositId: string; txId: string }>): Promise<void> {
    const { depositId, txId } = job.data;
    const deposit = await this.depositService.getDepositById(depositId);

    if (
      !deposit ||
      deposit.status === DepositStatus.COMPLETED ||
      deposit.status === DepositStatus.FAILED
    ) {
      return;
    }

    const network = this.networkRegistry.getNetwork('tron');
    const adapter = this.adapter();
    const txInfo = await adapter.getTransactionInfo(txId);
    const currentBlock = await adapter.getCurrentBlock();
    const confirmations = Math.max(0, currentBlock - txInfo.blockNumber + 1);

    await this.depositService.updateConfirmations(depositId, confirmations);

    if (confirmations >= network.confirmations) {
      await this.enqueueCredit(deposit.id, deposit.userId);
    } else {
      await this.enqueueConfirm(deposit.id, txId);
    }
  }

  private async enqueueCredit(depositId: string, userId: string): Promise<void> {
    await this.confirmationQueue.add(
      'credit-deposit',
      { depositId, userId },
      {
        jobId: `tron-credit-${depositId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private async enqueueConfirm(depositId: string, txId: string): Promise<void> {
    await this.tronQueue.add(
      'confirm-tron-deposit',
      { depositId, txId },
      {
        jobId: `tron-confirm-${depositId}`,
        delay: 30000,
        attempts: 20,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
