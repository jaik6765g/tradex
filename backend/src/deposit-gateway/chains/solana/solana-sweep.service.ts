import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import {
  DepositSweep,
  DepositSweepStatus,
} from '../../sweeps/deposit-sweep.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import type { NetworkConfig } from '../../networks/network-registry.service';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { SolanaDepositAdapter } from './solana-deposit-adapter';
import {
  SolanaCustodySigner,
  deriveNonceAccount,
} from './solana-custody-signer';
import { isValidSolanaAddress } from './solana-address';
import {
  GAS_FUNDING_PROVIDER,
  type GasFundingProvider,
} from '../../gas/gas-funding-provider.interface';

export const SOLANA_SWEEP_GAS_LAMPORTS_DEFAULT = 5000;

export function solanaSweepGasLamports(configured: string): bigint {
  const n = Number(configured);
  const safe = Number.isFinite(n) && n > 0 ? n : SOLANA_SWEEP_GAS_LAMPORTS_DEFAULT;
  return BigInt(Math.round(safe));
}

export function isSufficientSolLamports(
  balanceLamports: bigint,
  requiredLamports: bigint,
): boolean {
  return balanceLamports >= requiredLamports;
}

@Injectable()
export class SolanaDepositSweepService {
  private readonly logger = new Logger(SolanaDepositSweepService.name);

  constructor(
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    private readonly addressService: DepositAddressService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    private readonly signer: SolanaCustodySigner,
    private readonly dataSource: DataSource,
    @Inject(GAS_FUNDING_PROVIDER)
    private readonly gasFunding: GasFundingProvider,
  ) {}

  private terminal(status: string | null | undefined): boolean {
    return (
      status === DepositSweepStatus.COMPLETED ||
      status === DepositSweepStatus.FAILED ||
      status === DepositSweepStatus.MANUAL_REVIEW
    );
  }

  async executeSolanaSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (this.terminal(sweep.status)) return;
    if (sweep.sweepTxHash && sweep.status === DepositSweepStatus.SUBMITTED) {
      await this.confirmSolanaSweep(sweepId);
      return;
    }

    const deposit = await this.depositRepo.findOne({
      where: { id: sweep.depositId ?? '' },
    });
    if (!deposit) {
      await this.mark(sweep, DepositSweepStatus.FAILED, 'Deposit not found');
      return;
    }

    const network = this.networkRegistry.getNetwork('solana');
    const destination = this.resolveTreasury(network);

    if (!isValidSolanaAddress(destination)) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'SOLANA treasury missing/invalid',
      );
      return;
    }
    if (destination === deposit.depositAddress) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'SOLANA treasury equals deposit address',
      );
      return;
    }
    const depositAddr = deposit.depositAddress;
    if (!depositAddr) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Deposit has no deposit address',
      );
      return;
    }

    const addressEntity = await this.addressService.findByAddressAndChainId(
      depositAddr,
      SOLANA_CHAIN_ID,
    );
    if (!addressEntity) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Deposit address record not found',
      );
      return;
    }

    const adapter = new SolanaDepositAdapter(network);
    const fromLamports = await adapter.getBalanceLamports(depositAddr);
    const requiredLamports = solanaSweepGasLamports(
      this.configService.get<string>('SOLANA_SWEEP_GAS_LAMPORTS') ?? '',
    );

    if (!isSufficientSolLamports(fromLamports, requiredLamports)) {
      sweep.status = DepositSweepStatus.GAS_REQUIRED;
      sweep.failureReason = `Insufficient SOL ${fromLamports} < ${requiredLamports}`;
      await this.sweepRepo.save(sweep);
      throw new Error('Insufficient SOL gas');
    }

    const nonceAccount = deriveNonceAccount(depositAddr);
    const nonceData = await adapter.getNonceAccount(nonceAccount);
    if (!nonceData) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'SOLANA nonce account not funded',
      );
      return;
    }

    try {
      const { txId, signedBase64 } = await this.signer.signSplTransfer({
        rpcUrl: network.rpcUrls[0],
        mint: network.usdtContract,
        from: depositAddr,
        to: destination,
        amountRaw: deposit.amount,
        derivationIndex: addressEntity.derivationIndex ?? 0,
        nonceAccount,
        nonceBlockhash: nonceData.blockhash,
        feeLamports: requiredLamports.toString(),
      });

      sweep.status = DepositSweepStatus.SUBMITTED;
      sweep.sweepTxHash = txId;
      sweep.submittedAt = new Date();
      sweep.failureReason = null;
      await this.sweepRepo.save(sweep);

      await this.dataSource.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [`solana-sweep-addr-${depositAddr}`],
      );

      const broadcastSig = await adapter.sendRawTransaction(signedBase64);
      if (broadcastSig && broadcastSig !== sweep.sweepTxHash) {
        sweep.sweepTxHash = broadcastSig;
        await this.sweepRepo.save(sweep);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SOLANA sweep failed: ${message}`);
      if (sweep.status !== DepositSweepStatus.SUBMITTED) {
        sweep.failureReason = message;
        await this.sweepRepo.save(sweep);
      }
      throw error;
    }
  }

  async confirmSolanaSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (this.terminal(sweep.status)) return;
    if (!sweep.sweepTxHash) {
      throw new Error('SOLANA sweep has no transaction signature');
    }

    const network = this.networkRegistry.getNetwork('solana');
    if (!network.configured) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'SOLANA not configured',
      );
      return;
    }

    const adapter = new SolanaDepositAdapter(network);
    const status = await adapter.getSignatureStatuses([sweep.sweepTxHash]);
    const found = status.find((s) => s?.signature === sweep.sweepTxHash);

    if (!found) {
      throw new Error('SOLANA sweep signature not yet indexed');
    }
    if (found.err) {
      await this.mark(
        sweep,
        DepositSweepStatus.FAILED,
        'SOLANA sweep reverted/failed',
      );
      return;
    }
    if (
      found.confirmationStatus === 'confirmed' ||
      found.confirmationStatus === 'finalized'
    ) {
      sweep.status = DepositSweepStatus.COMPLETED;
      sweep.confirmedAt = new Date();
      sweep.failureReason = null;
      await this.sweepRepo.save(sweep);
    } else {
      throw new Error('SOLANA sweep not yet confirmed');
    }
  }

  private resolveTreasury(network: NetworkConfig): string {
    return (
      network.treasuryAddress ||
      this.configService.get<string>('SOLANA_TREASURY_ADDRESS') ||
      this.configService.get<string>('DEPOSIT_TREASURY_ADDRESS') ||
      ''
    ).trim();
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
