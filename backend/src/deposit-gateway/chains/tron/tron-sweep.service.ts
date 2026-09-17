import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import {
  DepositSweep,
  DepositSweepStatus,
} from '../../sweeps/deposit-sweep.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import type { NetworkConfig } from '../../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import { TronDepositAdapter } from './tron-deposit-adapter';
import { TronCustodySigner } from './tron-custody-signer';
import { isValidTronAddress } from './tron-address';
import {
  GAS_FUNDING_PROVIDER,
  type GasFundingProvider,
} from '../../gas/gas-funding-provider.interface';

export const TRON_SWEEP_GAS_SUN_PER_TRX = 1_000_000n;

/** Required TRX (sun) for a TRC-20 sweep, derived from a whole-TRX config value. */
export function tronSweepGasSun(gasTrx: number): bigint {
  const safe = Number.isFinite(gasTrx) ? gasTrx : 0;
  return BigInt(Math.max(1, Math.round(safe))) * TRON_SWEEP_GAS_SUN_PER_TRX;
}

export function isSufficientGas(
  balanceSun: bigint,
  requiredSun: bigint,
): boolean {
  return balanceSun >= requiredSun;
}

@Injectable()
export class TronDepositSweepService {
  private readonly logger = new Logger(TronDepositSweepService.name);

  constructor(
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    private readonly addressService: DepositAddressService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    private readonly signer: TronCustodySigner,
    private readonly dataSource: DataSource,
    @Inject(GAS_FUNDING_PROVIDER)
    private readonly gasFunding: GasFundingProvider,
    @InjectQueue('deposit-sweep-confirmation')
    private readonly confirmQueue: Queue,
  ) {}

  /**
   * Test/extension seam for building the TRON adapter. Nest never injects this
   * field — unit tests override it with a mock adapter.
   */
  adapterFactory: (network: NetworkConfig) => TronDepositAdapter = (network) =>
    new TronDepositAdapter(
      network,
      globalThis.fetch,
      this.configService.get<string>('TRON_GRID_API_KEY')?.trim() || undefined,
    );

  private terminal(status: string | null | undefined): boolean {
    return (
      status === DepositSweepStatus.COMPLETED ||
      status === DepositSweepStatus.FAILED ||
      status === DepositSweepStatus.MANUAL_REVIEW
    );
  }

  async executeTronSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (this.terminal(sweep.status)) return;

    // Broadcast recovery: if a hash is already persisted, the transaction was
    // (possibly) broadcast. NEVER re-broadcast — move to confirmation.
    if (sweep.sweepTxHash && sweep.status === DepositSweepStatus.SUBMITTED) {
      await this.confirmTronSweep(sweepId);
      return;
    }

    const deposit = await this.depositRepo.findOne({
      where: { id: sweep.depositId ?? '' },
    });
    if (!deposit) {
      await this.mark(sweep, DepositSweepStatus.FAILED, 'Deposit not found');
      return;
    }

    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured || network.protocol !== 'TRON') {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'TRON not configured');
      return;
    }

    const destination = network.treasuryAddress.trim();
    const from = deposit.depositAddress ?? '';
    const amountSunRaw = String(deposit.amount ?? '0');
    const amountSun = BigInt(amountSunRaw);

    const addressEntity = from
      ? await this.addressService.findByAddressAndChainId(from, TRON_CHAIN_ID)
      : null;

    // -- treasury safety: validate every sweep vector before signing --
    if (!isValidTronAddress(from)) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'Invalid TRON source address');
      return;
    }
    if (!isValidTronAddress(destination) || destination === from) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'Invalid or self TRON treasury address');
      return;
    }
    if (amountSun <= 0n) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'Zero sweep amount');
      return;
    }
    if (sweep.tokenAddress && sweep.tokenAddress !== network.usdtContract) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'Sweep token does not match configured TRON USDT');
      return;
    }
    if (!addressEntity || addressEntity.derivationIndex == null) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'TRON deposit address / derivation index missing');
      return;
    }

    const gasTrx = Number(this.configService.get<string>('TRON_SWEEP_GAS_TRX') ?? '20') || 20;
    const requiredSun = tronSweepGasSun(gasTrx);

    if (
      this.configService.get<string>('DEPOSIT_SWEEP_ENABLED') !== 'true' ||
      !this.signer.canSign()
    ) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'TRON sweep signing not configured');
      return;
    }

    const adapter = this.adapterFactory(network);

    // Gas: TRX only ever pays fees; never attempt sign/broadcast without it.
    const balance = await adapter.getNativeBalance(from);
    if (!isSufficientGas(balance, requiredSun)) {
      sweep.status = DepositSweepStatus.GAS_REQUIRED;
      sweep.failureReason = `Insufficient TRX ${balance} < ${requiredSun}`;
      await this.sweepRepo.save(sweep);
      const funded = await this.gasFunding.fundIfNeeded({
        chainId: TRON_CHAIN_ID,
        address: from,
        requiredWei: requiredSun,
      });
      if (!funded.funded) {
        // No auto-funding configured / provider declined: stop retrying.
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          'GAS_REQUIRED and no automatic gas funding configured',
        );
        return;
      }
      throw new Error('Insufficient TRX gas — retrying after funding window');
    }

    try {
      const { signed, txID } = await this.signer.signTrc20Transfer({
        rpcUrl: network.rpcUrls[0],
        tokenAddress: network.usdtContract,
        from,
        to: destination,
        amountSun: amountSunRaw,
        derivationIndex: addressEntity.derivationIndex,
        feeLimitSun: requiredSun.toString(),
      });

      // Persist SUBMITTED + deterministic txID BEFORE broadcast so a crash
      // after broadcast can never cause a second broadcast (recovery branch).
      sweep.status = DepositSweepStatus.SUBMITTED;
      sweep.sweepTxHash = txID;
      sweep.submittedAt = new Date();
      sweep.failureReason = null;
      await this.sweepRepo.save(sweep);

      // Serialize sweeps per deposit address: one active broadcast at a time.
      await this.dataSource.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [`tron-sweep-addr-${from}`],
      );

      const broadcastTxid = await this.signer.broadcastSigned(signed, network.rpcUrls[0]);
      const txHash = broadcastTxid || txID;
      if (txHash !== sweep.sweepTxHash && txHash) {
        sweep.sweepTxHash = txHash;
        await this.sweepRepo.save(sweep);
      }

      await this.confirmQueue.add(
        'confirm-sweep',
        { sweepId: sweep.id },
        {
          jobId: `confirm-sweep-${sweep.id}`,
          attempts: 20,
          backoff: { type: 'exponential', delay: 15000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`TRON sweep sign/broadcast failed: ${message}`);
      // If the tx was already persisted as SUBMITTED, leave it to confirmation /
      // reconciliation — do not blindly mark failed.
      if (sweep.status !== DepositSweepStatus.SUBMITTED) {
        sweep.failureReason = message;
        await this.sweepRepo.save(sweep);
      }
      throw error;
    }
  }

  async confirmTronSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (this.terminal(sweep.status)) return;
    if (!sweep.sweepTxHash) {
      throw new Error('TRON sweep has no transaction hash');
    }

    const network = this.networkRegistry.getNetwork('tron');
    if (!network.configured) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, 'TRON not configured');
      return;
    }

    const adapter = this.adapterFactory(network);
    const info = await adapter.getTransactionInfo(sweep.sweepTxHash);
    if (info.success) {
      sweep.status = DepositSweepStatus.COMPLETED;
      sweep.confirmedAt = new Date();
      sweep.failureReason = null;
      await this.sweepRepo.save(sweep);
    } else {
      await this.mark(sweep, DepositSweepStatus.FAILED, 'TRON sweep reverted/failed');
    }
  }

  private async getById(id: string): Promise<DepositSweep> {
    const sweep = await this.sweepRepo.findOne({ where: { id } });
    if (!sweep) throw new Error('Sweep not found');
    return sweep;
  }

  private async mark(
    sweep: DepositSweep,
    status: DepositSweepStatus,
    failureReason: string,
  ): Promise<void> {
    sweep.status = status;
    sweep.failureReason = failureReason;
    await this.sweepRepo.save(sweep);
  }
}