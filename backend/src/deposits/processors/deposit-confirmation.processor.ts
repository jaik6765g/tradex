import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { DepositService } from '../deposit.service';
import { DepositStatus } from '../deposit.entity';

@Processor('deposit-confirmation')
@Injectable()
export class DepositConfirmationProcessor {
  private readonly provider: ethers.JsonRpcProvider;

  constructor(
    private depositService: DepositService,
    private configService: ConfigService,
    @InjectQueue('deposit-confirmation') private confirmationQueue: Queue,
  ) {
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL') || '';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  @Process('confirm-deposit')
  async handleDepositConfirmation(job: Job): Promise<void> {
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

      const receipt =
        await this.provider.getTransactionReceipt(transactionHash);
      if (!receipt) {
        throw new Error('Transaction receipt not found');
      }

      const currentBlock = await this.provider.getBlockNumber();
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
        await job.progress(progress);

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
