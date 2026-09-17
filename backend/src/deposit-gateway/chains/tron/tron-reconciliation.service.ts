import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';

import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import { DepositSweep, DepositSweepStatus } from '../../sweeps/deposit-sweep.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import { TronDepositAdapter } from './tron-deposit-adapter';

export interface TronAddressAccounting {
  address: string;
  userId: string | null;
  balanceSun: string;
  depositedSun: string;
  sweptSun: string;
  pendingSweepSun: string;
  expectedRemainingSun: string;
  residualSun: string;
  status: 'MATCHED' | 'RESIDUAL' | 'UNDER' | 'UNKNOWN';
}

/** Pure accounting: confirmed deposits − completed sweeps vs on-chain balance. */
export function computeTronAccounting(input: {
  balanceSun: bigint;
  confirmedDepositSun: bigint[];
  completedSweepSun: bigint[];
}): {
  depositedSun: bigint;
  sweptSun: bigint;
  expectedRemainingSun: bigint;
  residualSun: bigint;
} {
  const depositedSun = input.confirmedDepositSun.reduce((a, b) => a + b, 0n);
  const sweptSun = input.completedSweepSun.reduce((a, b) => a + b, 0n);
  const expectedRemainingSun = depositedSun - sweptSun;
  return {
    depositedSun,
    sweptSun,
    expectedRemainingSun,
    residualSun: input.balanceSun - expectedRemainingSun,
  };
}

export function classifyAccountStatus(
  residualSun: bigint,
  balanceSun: bigint,
  pendingSweepSun: bigint,
): TronAddressAccounting['status'] {
  if (residualSun > 0n) return 'RESIDUAL';
  if (residualSun < 0n || balanceSun < pendingSweepSun) return 'UNDER';
  return 'MATCHED';
}
@Injectable()
export class TronReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(TronReconciliationService.name);
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
    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured) return;
    const minutes = Number(
      this.configService.get<string>('TRON_RECONCILIATION_INTERVAL_MINUTES') ?? '15',
    );
    this.intervalHandle = setInterval(() => {
      void this.reconcileAndLog();
    }, Math.max(1, minutes) * 60_000);
    this.logger.log('TRON full-balance reconciliation scheduler started');
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Safe runtime status (never exposes keys/secrets). */
  status(): { running: boolean; lastReconciledCount: number } {
    return { running: this.intervalHandle !== null, lastReconciledCount: this.lastReconciledCount };
  }

  async reconcileAndLog(): Promise<void> {
    try {
      const rows = await this.reconcile();
      this.lastReconciledCount = rows.length;
      for (const row of rows) {
        if (row.status !== 'MATCHED') {
          this.logger.warn(
            `TRON reconciliation {${row.address}} status=${row.status} ` +
              `balance=${row.balanceSun} deposited=${row.depositedSun} swept=${row.sweptSun} residual=${row.residualSun}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`TRON reconciliation error: ${(error as Error).message}`);
    }
  }

  /** Compute per-address accounting against live TronGrid (read-only). */
  async reconcile(): Promise<TronAddressAccounting[]> {
    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured) return [];
    const adapter = new TronDepositAdapter(
      network,
      globalThis.fetch,
      this.configService.get<string>('TRON_GRID_API_KEY')?.trim() || undefined,
    );

    const addresses = await this.addressService.findActiveByChain(TRON_CHAIN_ID);
    const rows: TronAddressAccounting[] = [];

    for (const addr of addresses) {
      const deposits = await this.depositRepo.find({
        where: {
          depositAddress: addr.address,
          chainId: TRON_CHAIN_ID,
          status: In([DepositStatus.VERIFIED, DepositStatus.COMPLETED]),
        },
      });

      const depositIds = deposits.map((d) => d.id);
      const sweeps = depositIds.length
        ? await this.sweepRepo.find({ where: { depositId: In(depositIds) } })
        : [];

      const confirmedDepositSun = deposits.map((d) => BigInt(d.amount || '0'));
      const completedSweepSun = sweeps
        .filter((s) => s.status === DepositSweepStatus.COMPLETED)
        .map((s) => {
          const dep = deposits.find((d) => d.id === s.depositId);
          return BigInt(dep?.amount || s.amount || '0');
        });
      const pendingSweepSun = sweeps
        .filter((s) =>
          [DepositSweepStatus.PENDING, DepositSweepStatus.SUBMITTED].includes(
            s.status as DepositSweepStatus,
          ),
        )
        .reduce(
          (sum, s) => {
            const dep = deposits.find((d) => d.id === s.depositId);
            return sum + BigInt(dep?.amount || '0');
          },
          0n,
        );

      const balanceSun = await adapter.getTokenBalance(addr.address);
      const acc = computeTronAccounting({
        balanceSun,
        confirmedDepositSun,
        completedSweepSun,
      });

      const status = classifyAccountStatus(
        acc.residualSun,
        balanceSun,
        pendingSweepSun,
      );

      rows.push({
        address: addr.address,
        userId: addr.userId,
        balanceSun: balanceSun.toString(),
        depositedSun: acc.depositedSun.toString(),
        sweptSun: acc.sweptSun.toString(),
        pendingSweepSun: pendingSweepSun.toString(),
        expectedRemainingSun: acc.expectedRemainingSun.toString(),
        residualSun: acc.residualSun.toString(),
        status,
      });
    }

    return rows;
  }
}