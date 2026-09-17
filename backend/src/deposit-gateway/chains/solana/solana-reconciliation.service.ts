import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';

import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import {
  DepositSweep,
  DepositSweepStatus,
} from '../../sweeps/deposit-sweep.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { SolanaDepositAdapter } from './solana-deposit-adapter';

export interface SolanaAddressAccounting {
  address: string;
  userId: string | null;
  usdtBalanceRaw: string;
  depositedRaw: string;
  sweptRaw: string;
  pendingSweepRaw: string;
  expectedRemainingRaw: string;
  residualRaw: string;
  status: 'MATCHED' | 'RESIDUAL' | 'UNDER' | 'UNKNOWN';
  tokenAccount: string | null;
}

export function computeSolanaAccounting(input: {
  balanceRaw: bigint;
  confirmedDepositRaw: bigint[];
  completedSweepRaw: bigint[];
  pendingSweepRaw: bigint;
}): {
  depositedRaw: bigint;
  sweptRaw: bigint;
  expectedRemainingRaw: bigint;
  residualRaw: bigint;
  status: 'MATCHED' | 'RESIDUAL' | 'UNDER' | 'UNKNOWN';
} {
  const depositedRaw = input.confirmedDepositRaw.reduce((a, b) => a + b, 0n);
  const sweptRaw = input.completedSweepRaw.reduce((a, b) => a + b, 0n);
  const expectedRemainingRaw = depositedRaw - sweptRaw;
  const residualRaw = input.balanceRaw - expectedRemainingRaw;

  let status: 'MATCHED' | 'RESIDUAL' | 'UNDER' | 'UNKNOWN';
  if (input.balanceRaw === 0n && expectedRemainingRaw === 0n) {
    status = 'MATCHED';
  } else if (residualRaw > 0n) {
    status = 'RESIDUAL';
  } else if (residualRaw < 0n) {
    status = 'UNDER';
  } else {
    status = 'MATCHED';
  }

  return { depositedRaw, sweptRaw, expectedRemainingRaw, residualRaw, status };
}

@Injectable()
export class SolanaReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(SolanaReconciliationService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastReconciledCount = 0;

  constructor(
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    private readonly addressService: DepositAddressService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const network = this.networkRegistry.getNetwork('solana');
    if (!network.configured) return;
    const minutes = Number(
      this.configService.get<string>(
        'SOLANA_RECONCILIATION_INTERVAL_MINUTES',
      ) ?? '15',
    );
    this.intervalHandle = setInterval(() => {
      void this.reconcileAndLog();
    }, Math.max(1, minutes) * 60_000);
    this.logger.log('SOLANA full-balance reconciliation scheduler started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  status(): { running: boolean; lastReconciledCount: number } {
    return {
      running: this.intervalHandle !== null,
      lastReconciledCount: this.lastReconciledCount,
    };
  }

  async reconcileAndLog(): Promise<void> {
    try {
      const rows = await this.reconcile();
      this.lastReconciledCount = rows.length;
      for (const row of rows) {
        if (row.status !== 'MATCHED') {
          this.logger.warn(
            `SOLANA reconciliation {${row.address}} status=${row.status} ` +
              `balance=${row.usdtBalanceRaw} deposited=${row.depositedRaw} swept=${row.sweptRaw} residual=${row.residualRaw}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `SOLANA reconciliation error: ${(error as Error).message}`,
      );
    }
  }

  async reconcile(): Promise<SolanaAddressAccounting[]> {
    const network = this.networkRegistry.getNetwork('solana');
    if (!network.configured) return [];
    const adapter = new SolanaDepositAdapter(network);

    const addresses = await this.addressService.findActiveByChain(
      SOLANA_CHAIN_ID,
    );
    const rows: SolanaAddressAccounting[] = [];

    for (const addr of addresses) {
      let tokenAccount: string | null = null;
      let balanceRaw = 0n;
      try {
        const tokenAccounts = await adapter.getTokenAccountsByOwner(
          addr.address,
          network.usdtContract,
        );
        if (tokenAccounts.length === 0) {
          // No USDT token account exists yet — nothing to reconcile.
          // Still push a zero-balance row so the address is visible.
          rows.push({
            address: addr.address,
            userId: addr.userId,
            usdtBalanceRaw: '0',
            depositedRaw: '0',
            sweptRaw: '0',
            pendingSweepRaw: '0',
            expectedRemainingRaw: '0',
            residualRaw: '0',
            status: 'MATCHED',
            tokenAccount: null,
          });
          continue;
        }

        if (tokenAccounts.length > 1) {
          // Multiple USDT token accounts for one address is ambiguous.
          // Sum the balances but flag as UNKNOWN for manual review —
          // reconciliation must never silently assume which account is canonical.
          let totalBalance = 0n;
          for (const ta of tokenAccounts) {
            try {
              totalBalance += await adapter.getTokenBalance(ta);
            } catch {
              // Skip individual account errors; partial data still useful.
            }
          }

          // Compute deposits/sweeps for the accounting side.
          const deposits = await this.depositRepo.find({
            where: {
              depositAddress: addr.address,
              chainId: SOLANA_CHAIN_ID,
              status: In([DepositStatus.VERIFIED, DepositStatus.COMPLETED]),
            },
          });
          const depositIds = deposits.map((d) => d.id);
          const sweeps = depositIds.length
            ? await this.sweepRepo.find({ where: { depositId: In(depositIds) } })
            : [];
          const confirmedDepositRaw = deposits.map((d) => BigInt(d.amount || '0'));
          const completedSweepRaw = sweeps
            .filter((s) => s.status === DepositSweepStatus.COMPLETED)
            .map((s) => {
              const dep = deposits.find((d) => d.id === s.depositId);
              return BigInt(dep?.amount || s.amount || '0');
            });
          const pendingSweepRaw = sweeps
            .filter((s) =>
              [DepositSweepStatus.PENDING, DepositSweepStatus.SUBMITTED].includes(
                s.status as DepositSweepStatus,
              ),
            )
            .reduce((sum, s) => {
              const dep = deposits.find((d) => d.id === s.depositId);
              return sum + BigInt(dep?.amount || '0');
            }, 0n);
          const acc = computeSolanaAccounting({
            balanceRaw: totalBalance,
            confirmedDepositRaw,
            completedSweepRaw,
            pendingSweepRaw,
          });

          rows.push({
            address: addr.address,
            userId: addr.userId,
            usdtBalanceRaw: totalBalance.toString(),
            depositedRaw: acc.depositedRaw.toString(),
            sweptRaw: acc.sweptRaw.toString(),
            pendingSweepRaw: pendingSweepRaw.toString(),
            expectedRemainingRaw: acc.expectedRemainingRaw.toString(),
            residualRaw: acc.residualRaw.toString(),
            status: 'UNKNOWN',
            tokenAccount: tokenAccounts.join(','),
          });
          continue;
        }

        tokenAccount = tokenAccounts[0];
        balanceRaw = await adapter.getTokenBalance(tokenAccount);
      } catch {
        continue;
      }

      const deposits = await this.depositRepo.find({
        where: {
          depositAddress: addr.address,
          chainId: SOLANA_CHAIN_ID,
          status: In([DepositStatus.VERIFIED, DepositStatus.COMPLETED]),
        },
      });

      const depositIds = deposits.map((d) => d.id);
      const sweeps = depositIds.length
        ? await this.sweepRepo.find({ where: { depositId: In(depositIds) } })
        : [];

      const confirmedDepositRaw = deposits.map((d) => BigInt(d.amount || '0'));
      const completedSweepRaw = sweeps
        .filter((s) => s.status === DepositSweepStatus.COMPLETED)
        .map((s) => {
          const dep = deposits.find((d) => d.id === s.depositId);
          return BigInt(dep?.amount || s.amount || '0');
        });
      const pendingSweepRaw = sweeps
        .filter((s) =>
          [DepositSweepStatus.PENDING, DepositSweepStatus.SUBMITTED].includes(
            s.status as DepositSweepStatus,
          ),
        )
        .reduce((sum, s) => {
          const dep = deposits.find((d) => d.id === s.depositId);
          return sum + BigInt(dep?.amount || '0');
        }, 0n);

      const acc = computeSolanaAccounting({
        balanceRaw,
        confirmedDepositRaw,
        completedSweepRaw,
        pendingSweepRaw: pendingSweepRaw,
      });

      rows.push({
        address: addr.address,
        userId: addr.userId,
        usdtBalanceRaw: balanceRaw.toString(),
        depositedRaw: acc.depositedRaw.toString(),
        sweptRaw: acc.sweptRaw.toString(),
        pendingSweepRaw: pendingSweepRaw.toString(),
        expectedRemainingRaw: acc.expectedRemainingRaw.toString(),
        residualRaw: acc.residualRaw.toString(),
        status: acc.status,
        tokenAccount,
      });
    }

    return rows;
  }
}
