import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import {
  DepositSweep,
  DepositSweepStatus,
} from '../../sweeps/deposit-sweep.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { ChainRegistryService } from '../chain-registry.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { POLYGON_CHAIN_ID, ARBITRUM_CHAIN_ID } from '../../config/networks.config';

export interface EvmAddressAccounting {
  chainId: number;
  address: string;
  userId: string | null;
  usdtBalanceRaw: string;
  depositedRaw: string;
  sweptRaw: string;
  pendingSweepRaw: string;
  expectedRemainingRaw: string;
  residualRaw: string;
  status: 'MATCHED' | 'RESIDUAL' | 'UNDER' | 'UNKNOWN';
}

/**
 * Pure accounting math (bigint only, no floats):
 *   confirmed deposits − completed sweeps = expected remaining
 *   residual = on-chain USDT balance − expected remaining
 * Pending/Submitted sweeps are NOT counted as completed; FAILED/MANUAL_REVIEW
 * sweeps are excluded entirely. Read-only: inputs are never mutated.
 */
export function computeEvmAccounting(input: {
  balanceRaw: bigint;
  confirmedDepositRaw: bigint[];
  completedSweepRaw: bigint[];
}): {
  depositedRaw: bigint;
  sweptRaw: bigint;
  expectedRemainingRaw: bigint;
  residualRaw: bigint;
  status: 'MATCHED' | 'RESIDUAL' | 'UNDER';
} {
  const depositedRaw = input.confirmedDepositRaw.reduce((a, b) => a + b, 0n);
  const sweptRaw = input.completedSweepRaw.reduce((a, b) => a + b, 0n);
  const expectedRemainingRaw = depositedRaw - sweptRaw;
  const residualRaw = input.balanceRaw - expectedRemainingRaw;

  let status: 'MATCHED' | 'RESIDUAL' | 'UNDER';
  if (residualRaw === 0n) {
    status = 'MATCHED';
  } else if (residualRaw > 0n) {
    status = 'RESIDUAL';
  } else {
    status = 'UNDER';
  }

  return { depositedRaw, sweptRaw, expectedRemainingRaw, residualRaw, status };
}

/**
 * Read-only EVM balance reconciliation (Phase 7.1 — Polygon + Arbitrum via the
 * generic engine). NEVER mutates balances and NEVER auto-sweeps residuals:
 * RESIDUAL/UNDER remain operator-visible manual-review concerns.
 */
@Injectable()
export class EvmBalanceReconciliationService {
  private readonly logger = new Logger(EvmBalanceReconciliationService.name);

  constructor(
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    private readonly addressService: DepositAddressService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
  ) {}

  /** Reconcile one EVM network independently (e.g. polygon, arbitrum). */
  async reconcileChain(chainId: number): Promise<EvmAddressAccounting[]> {
    const network = this.networkRegistry.getNetworkByChainId(chainId);
    if (!network || network.protocol !== 'EVM' || !network.configured) {
      return [];
    }
    let adapter;
    try {
      adapter = this.chainRegistry.getAdapter(chainId);
    } catch {
      return [];
    }
    if (typeof adapter.getTokenBalance !== 'function') {
      // Adapter cannot read balances — report nothing rather than guessing.
      return [];
    }

    const addresses = await this.addressService.findActiveByChain(chainId);
    const rows: EvmAddressAccounting[] = [];

    for (const addr of addresses) {
      let balanceRaw: bigint;
      try {
        balanceRaw = await adapter.getTokenBalance(
          network.usdtContract,
          addr.address,
        );
      } catch (error) {
        // RPC failure does not mutate accounting — skip, never guess.
        this.logger.warn(
          `EVM reconciliation balance read failed (chain ${chainId}, ${addr.address}): ${(error as Error).message}`,
        );
        continue;
      }

      const deposits = await this.depositRepo.find({
        where: {
          depositAddress: addr.address,
          chainId,
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

      const acc = computeEvmAccounting({
        balanceRaw,
        confirmedDepositRaw,
        completedSweepRaw,
      });

      rows.push({
        chainId,
        address: addr.address,
        userId: addr.userId,
        usdtBalanceRaw: balanceRaw.toString(),
        depositedRaw: acc.depositedRaw.toString(),
        sweptRaw: acc.sweptRaw.toString(),
        pendingSweepRaw: sweeps
          .filter((s) =>
            [DepositSweepStatus.PENDING, DepositSweepStatus.SUBMITTED].includes(
              s.status as DepositSweepStatus,
            ),
          )
          .reduce((sum, s) => {
            const dep = deposits.find((d) => d.id === s.depositId);
            return sum + BigInt(dep?.amount || '0');
          }, 0n)
          .toString(),
        expectedRemainingRaw: acc.expectedRemainingRaw.toString(),
        residualRaw: acc.residualRaw.toString(),
        status: acc.status,
      });
    }

    return rows;
  }

  /** Convenience: reconcile Polygon and Arbitrum independently. */
  async reconcilePolygonArbitrum(): Promise<EvmAddressAccounting[]> {
    const [polygon, arbitrum] = await Promise.all([
      this.reconcileChain(POLYGON_CHAIN_ID),
      this.reconcileChain(ARBITRUM_CHAIN_ID),
    ]);
    return [...polygon, ...arbitrum];
  }
}