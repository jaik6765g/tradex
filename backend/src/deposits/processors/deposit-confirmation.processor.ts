import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { DepositService } from '../deposit.service';
import { DepositStatus } from '../deposit.entity';
import { BscRpcService } from '../../blockchain/bsc/bsc-rpc.service';
import { DepositCreditProcessor } from './deposit-credit.processor';
import {
  EvmDepositConfirmationHandler,
} from './evm-deposit-confirmation.handler';

@Processor('deposit-confirmation')
@Injectable()
export class DepositConfirmationProcessor extends WorkerHost {
  constructor(
    private depositService: DepositService,
    private bscRpcService: BscRpcService,
    private creditProcessor: DepositCreditProcessor,
    private readonly evmConfirmation: EvmDepositConfirmationHandler,
    @InjectQueue('deposit-confirmation') private confirmationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'confirm-deposit') {
      const { chainId } = (job.data ?? {}) as { chainId?: number };

      // BSC keeps its dedicated BSC-specific path (behavior unchanged).
      if (
        typeof chainId === 'number' &&
        chainId === this.bscRpcService.getExpectedChainId()
      ) {
        await this.handleDepositConfirmation(job);
        return;
      }

      // Polygon/Arbitrum (Phase 7.1): generic EVM confirmation via ChainAdapter.
      if (
        typeof chainId === 'number' &&
        this.evmConfirmation.isSupportedChain(chainId)
      ) {
        await this.evmConfirmation.handle(job);
        return;
      }

      // All other chains: unchanged behavior (no confirmation path in this phase).
      return;
    }

    if (job.name === 'credit-deposit') {
      await this.creditProcessor.handleDepositCredit(job);
      return;
    }
  }

  private async handleDepositConfirmation(job: Job): Promise<void> {
    const { depositId, transactionHash, chainId } = job.data as {
      depositId: string;
      transactionHash: string;
      chainId: number;
    };

    console.log(`🔍 Confirming deposit: ${transactionHash}`);

    try {
      const deposit = await this.depositService.getDepositById(depositId);

      if (
        !deposit ||
        deposit.status === DepositStatus.COMPLETED ||
        deposit.status === DepositStatus.FAILED
      ) {
        return;
      }

      if (deposit.chainId !== chainId) {
        console.log(
          `⚠️ Confirmation skipped for ${transactionHash}: chain mismatch (payload=${chainId}, deposit=${deposit.chainId})`,
        );

        return;
      }

      // BSC Mainnet chain ID 56 verification
      const expectedChainId = this.bscRpcService.getExpectedChainId();
      if (chainId !== expectedChainId) {
        console.log(
          `⚠️ Confirmation skipped for ${transactionHash}: expected chain ${expectedChainId}, got ${chainId}`,
        );

        return;
      }

      // Resilient RPC: receipt fetch with automatic failover
      const receipt = await this.bscRpcService.withFailover(
        (provider) => provider.getTransactionReceipt(transactionHash),
        { label: `getTransactionReceipt(${transactionHash})` },
      );

      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      // Transaction success verification
      if (receipt.status !== 1) {
        console.log(
          `⚠️ Transaction reverted: ${transactionHash}`,
        );

        await this.depositService.updateDepositStatus(
          depositId,
          DepositStatus.FAILED,
          'Transaction reverted on BSC Mainnet',
        );

        return;
      }

      // Resilient RPC: current block with automatic failover
      const currentBlock = await this.bscRpcService.withFailover(
        (provider) => provider.getBlockNumber(),
        { label: 'getBlockNumber()' },
      );

      const confirmations = currentBlock - receipt.blockNumber + 1;

      await this.depositService.updateConfirmations(depositId, confirmations);

      if (confirmations >= deposit.requiredConfirmations) {
        console.log(
          `✅ Deposit verified: ${transactionHash} with ${confirmations} confirmations`,
        );

        const refreshedDeposit =
          await this.depositService.getDepositById(depositId);

        if (refreshedDeposit.status !== DepositStatus.VERIFIED) {
          console.log(
            `⚠️ Deposit status changed to ${refreshedDeposit.status}, skipping credit queue for ${transactionHash}`,
          );

          return;
        }

        await this.confirmationQueue.add(
          'credit-deposit',
          {
            depositId: refreshedDeposit.id,
            userId: refreshedDeposit.userId,
            usdtAmount: refreshedDeposit.usdtAmount,
            tdxAmount: refreshedDeposit.tdxAmount,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          },
        );
      } else {
        const progress = (confirmations / deposit.requiredConfirmations) * 100;
        await job.updateProgress(progress);

        console.log(
          `⏳ Waiting for confirmations: ${confirmations}/${deposit.requiredConfirmations}`,
        );

        const delay = 30000;
        await this.confirmationQueue.add(
          'confirm-deposit',
          {
            depositId: deposit.id,
            transactionHash,
            chainId,
          },
          {
            delay,
            attempts: 20,
            backoff: {
              type: 'exponential',
              delay: 30000,
            },
          },
        );
      }
    } catch (error) {
      console.error(`❌ Error confirming deposit:`, error);
      throw error;
    }
  }
}
