import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { DepositService } from '../deposit.service';
import { BalanceService } from '../../balances/balance.service';
import { LedgerType } from '../../ledger/ledger.entity';
import { DepositStatus } from '../deposit.entity';

@Processor('deposit-confirmation')
@Injectable()
export class DepositCreditProcessor {
  constructor(
    private depositService: DepositService,
    private balanceService: BalanceService,
  ) {}

  @Process('credit-deposit')
  async handleDepositCredit(job: Job): Promise<void> {
    const { depositId, userId } = job.data as {
      depositId: string;
      userId: string;
    };

    console.log(`💰 Crediting deposit: ${depositId}`);

    try {
      const deposit = await this.depositService.getDepositById(depositId);

      if (!deposit || deposit.status === DepositStatus.COMPLETED) {
        console.log(`⚠️ Deposit already credited or not found: ${depositId}`);
        return;
      }

      if (deposit.status === DepositStatus.FAILED) {
        console.log(`⚠️ Deposit is failed, skipping credit: ${depositId}`);
        return;
      }

      if (deposit.status !== DepositStatus.VERIFIED) {
        throw new Error(`Deposit not verified yet: ${deposit.status}`);
      }

      // ✅ FIX: Use deposit.tdxAmount from database
      const tdxAmountFromDb = deposit.tdxAmount;

      console.log('💰 TDX Amount from DB:', {
        tdxAmountFromDb,
        type: typeof tdxAmountFromDb,
        isFinite: Number.isFinite(tdxAmountFromDb),
        value: tdxAmountFromDb,
      });

      // ✅ FIX: Ensure tdxAmount is a valid number
      let amountToCredit: number;

      if (typeof tdxAmountFromDb === 'string') {
        amountToCredit = parseFloat(tdxAmountFromDb);
      } else if (typeof tdxAmountFromDb === 'number') {
        amountToCredit = tdxAmountFromDb;
      } else {
        throw new Error(`Unexpected tdxAmount type: ${typeof tdxAmountFromDb}`);
      }

      console.log('💰 Amount to credit:', {
        amountToCredit,
        isFinite: Number.isFinite(amountToCredit),
        isValid: amountToCredit > 0,
      });

      if (!Number.isFinite(amountToCredit) || amountToCredit <= 0) {
        throw new Error(`Invalid TDX amount: ${amountToCredit}`);
      }

      await this.balanceService.creditTDX(
        userId,
        amountToCredit, // ✅ Send as number
        LedgerType.DEPOSIT,
        `Deposit of ${deposit.usdtAmount} USDT converted to ${amountToCredit} TDX`,
        depositId,
        {
          usdtAmount: deposit.usdtAmount,
          rate: 100,
          transactionHash: deposit.transactionHash,
          chainId: deposit.chainId,
        },
      );

      await this.depositService.updateDepositStatus(
        depositId,
        DepositStatus.COMPLETED,
      );

      const updatedDeposit =
        await this.depositService.getDepositById(depositId);
      updatedDeposit.creditedAt = new Date();
      await this.depositService['depositRepository'].save(updatedDeposit);

      console.log(
        `✅ Deposit credited: ${amountToCredit} TDX to user ${userId}`,
      );
    } catch (error) {
      console.error(`❌ Error crediting deposit:`, error);
      throw error;
    }
  }
}
