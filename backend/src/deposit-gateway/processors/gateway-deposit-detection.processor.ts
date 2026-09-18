import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ethers } from 'ethers';

import { DepositService } from '../../deposits/deposit.service';
import { DepositStatus } from '../../deposits/deposit.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { TokenRegistryService } from '../tokens/token-registry.service';
import { ChainRegistryService } from '../chains/chain-registry.service';

interface GatewayDetectJobData {
  chainId: number;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  from: string;
  to: string;
  amount: string;
  tokenAddress: string;
  detectedAt: string;
}

export const GATEWAY_DETECTION_QUEUE = 'gateway-deposit-detection';

@Processor(GATEWAY_DETECTION_QUEUE)
@Injectable()
export class GatewayDepositDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(GatewayDepositDetectionProcessor.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly addressService: DepositAddressService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly chainRegistry: ChainRegistryService,
    @InjectQueue('deposit-confirmation')
    private readonly confirmationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<GatewayDetectJobData>): Promise<void> {
    const data = job.data;

    try {
      const adapter = this.chainRegistry.getAdapter(data.chainId);

      // Wrong token → never credit.
      const expectedToken = adapter.getTokenAddress('USDT');
      if (
        ethers.getAddress(data.tokenAddress) !== ethers.getAddress(expectedToken)
      ) {
        this.logger.warn(`Rejecting ${data.transactionHash}: token mismatch`);
        return;
      }

      const receipt = await adapter.getTransactionReceipt(data.transactionHash);
      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }
      if (receipt.status !== 1) {
        this.logger.warn(`Rejecting ${data.transactionHash}: reverted`);
        return;
      }

      // Recipient identifies the user (one address per user + network).
      const recipient = ethers.getAddress(data.to);
      const depositAddress = await this.addressService.findByAddressAndChainId(
        recipient,
        data.chainId,
      );
      if (!depositAddress || !depositAddress.userId) {
        this.logger.warn(
          `Ignoring ${data.transactionHash}: recipient is not an assigned deposit address`,
        );
        return;
      }

      const userId = depositAddress.userId;

      const receivedWei = BigInt(data.amount);
      if (receivedWei <= 0n) {
        this.logger.warn(`Ignoring ${data.transactionHash}: zero amount`);
        return;
      }

      const token = this.tokenRegistry.getToken('USDT', data.chainId);
      const receivedUnits = ethers.formatUnits(receivedWei, token.decimals);
      const confirmations = await adapter.getConfirmations(data.blockNumber);
      const blockTimestamp = await adapter.getBlockTimestamp(data.blockNumber);

      // Credit the ACTUAL received amount (1 USDT = 100 TDX) to the user.
      const tdxAmount = ethers.formatUnits(
        receivedWei * BigInt(token.tdxRate),
        token.decimals,
      );

      const deposit = await this.depositService.createDeposit({
        userId,
        walletId: null,
        orderId: depositAddress.orderId ?? null,
        depositAddress: recipient,
        chainId: data.chainId,
        transactionHash: data.transactionHash,
        blockNumber: data.blockNumber,
        blockTimestamp: new Date(blockTimestamp * 1000),
        vaultAddress: recipient,
        senderAddress: ethers.getAddress(data.from),
        amount: receivedWei.toString(),
        usdtAmount: receivedUnits,
        tdxAmount,
        confirmations,
        requiredConfirmations: adapter.getRequiredConfirmations(),
      });

      // Below-minimum on-chain deposit: recorded with the reviewable
      // BELOW_MINIMUM status and NEVER auto-credited, so no confirmation /
      // credit job is enqueued. An authorized admin decides CREDIT or REJECT
      // later (Architecture Plan v3, correction 2).
      if (deposit.status === DepositStatus.BELOW_MINIMUM) {
        this.logger.warn(
          `Deposit ${deposit.id} (${data.transactionHash}) recorded as BELOW_MINIMUM — no auto-credit; awaiting admin review`,
        );
        return;
      }

      await this.confirmationQueue.add(
        'confirm-deposit',
        {
          depositId: deposit.id,
          transactionHash: data.transactionHash,
          chainId: data.chainId,
        },
        {
          jobId: `confirm-${deposit.id}`,
          attempts: 20,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      const e = error as { status?: number; message?: string };
      if (e?.status === 409 || e?.message?.includes('already processed')) {
        this.logger.warn(`Duplicate detection for ${data?.transactionHash}`);
        return;
      }
      this.logger.error(`Gateway detection error: ${e?.message}`);
      throw error;
    }
  }
}
