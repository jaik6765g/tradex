import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { DataSource, Not, IsNull, Repository } from 'typeorm';
import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { keccak256 } from 'ethers';

import { Deposit, DepositStatus } from '../../deposits/deposit.entity';
import {
  DepositSweep,
  DepositSweepStatus,
} from './deposit-sweep.entity';
import {
  DepositAddress,
  DepositAddressStatus,
} from '../addresses/deposit-address.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import {
  isAutomaticSweepAllowed,
  normalizeCustodyState,
  CUSTODY_STATE_ENV_KEY,
} from '../custody/custody-state';
import { ChainRegistryService } from '../chains/chain-registry.service';
import { TokenRegistryService } from '../tokens/token-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import {
  DEPOSIT_TRANSACTION_SIGNER,
  type DepositTransactionSigner,
} from '../addresses/deposit-transaction-signer.interface';
import { TronDepositSweepService } from '../chains/tron/tron-sweep.service';
import { SolanaDepositSweepService } from '../chains/solana/solana-sweep.service';
import {
  GAS_FUNDING_PROVIDER,
  type GasFundingProvider,
} from '../gas/gas-funding-provider.interface';

export const SWEEP_QUEUE = 'deposit-sweep';
export const SWEEP_CONFIRMATION_QUEUE = 'deposit-sweep-confirmation';

@Injectable()
export class DepositSweepService {
  private readonly logger = new Logger(DepositSweepService.name);

  constructor(
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    private readonly dataSource: DataSource,
    private readonly addressService: DepositAddressService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly tronSweepService: TronDepositSweepService,
    private readonly solanaSweepService: SolanaDepositSweepService,
    private readonly configService: ConfigService,
    @Inject(DEPOSIT_TRANSACTION_SIGNER)
    private readonly signer: DepositTransactionSigner,
    @Inject(GAS_FUNDING_PROVIDER)
    private readonly gasFunding: GasFundingProvider,
    @InjectQueue(SWEEP_QUEUE)
    private readonly sweepQueue: Queue,
    @InjectQueue(SWEEP_CONFIRMATION_QUEUE)
    private readonly confirmQueue: Queue,
  ) {}

  /** Called by reconciliation: find credited gateway deposits lacking a sweep. */
  async scheduleDueSweeps(): Promise<number> {
    // Custody hardening: in LOCKDOWN/RECOVERY, do not schedule new sweeps.
    const state = normalizeCustodyState(
      this.configService.get<string>(CUSTODY_STATE_ENV_KEY),
    );
    if (!isAutomaticSweepAllowed(state)) {
      this.logger.warn(
        `Sweep scheduling skipped: custody state is ${state}`,
      );
      return 0;
    }

    const deposits = await this.depositRepo.find({
      where: { status: DepositStatus.COMPLETED, orderId: Not(IsNull()) },
      order: { createdAt: 'ASC' },
      take: 50,
    });

    for (const deposit of deposits) {
      await this.ensureSweep(deposit);
    }

    // GAS_REQUIRED recovery: sweeps parked because gas was insufficient at
    // execution time must resume once native gas arrives on the deposit
    // address. Re-enqueue them through the existing queue with the same
    // deterministic job id (BullMQ dedupes, so repeated scheduler cycles
    // cannot create duplicate jobs/sweeps). Bounded by the reconciliation
    // cadence — NOT a high-frequency retry loop.
    await this.requeueGasRequiredSweeps();

    return deposits.length;
  }

  /**
   * Re-enqueue sweeps parked at GAS_REQUIRED so they resume through the
   * normal hardened execution path once gas becomes sufficient.
   *
   * Safety:
   *  - Only GAS_REQUIRED sweeps are scanned (never SUBMITTED/BROADCASTING,
   *    never terminal) so mid-flight recovery is untouched.
   *  - Deterministic job id `sweep-<id>`: BullMQ dedupes, so concurrent
   *    scheduler cycles / multiple workers cannot create duplicate jobs.
   *  - If a previous job for the same sweep is retained in a terminal queue
   *    state (failed after its retry budget was exhausted while gas was
   *    still 0), it is removed first so the sweep can be re-enqueued. The
   *    sweep ROW is the source of truth — removing a dead queue job never
   *    mutates sweep state.
   *  - No broadcast happens here; executeSweep performs the full gas
   *    re-check and only proceeds when gas is genuinely sufficient.
   */
  private async requeueGasRequiredSweeps(): Promise<number> {
    if (!this.sweepEnabled()) return 0;

    const stuck = await this.sweepRepo.find({
      where: { status: DepositSweepStatus.GAS_REQUIRED },
      order: { createdAt: 'ASC' },
      take: 50,
    });
    if (stuck.length === 0) return 0;

    for (const sweep of stuck) {
      const jobId = `sweep-${sweep.id}`;
      try {
        const existingJob = await this.sweepQueue.getJob(jobId);
        if (existingJob) {
          const isActive = await existingJob.isActive();
          const isWaiting = await existingJob.isWaiting();
          const isDelayed = await existingJob.isDelayed();
          if (isActive || isWaiting || isDelayed) {
            // A live job for this sweep is already queued/running — skip.
            continue;
          }
          // Terminal queue state (failed/completed): remove the dead job so
          // the sweep can be re-enqueued. This does NOT touch sweep state.
          await existingJob.remove();
        }
      } catch (error) {
        this.logger.warn(
          `GAS_REQUIRED requeue: could not inspect job ${jobId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      await this.sweepQueue.add(
        'process-sweep',
        { sweepId: sweep.id },
        {
          jobId,
          attempts: 8,
          backoff: { type: 'exponential', delay: 15000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(
        `GAS_REQUIRED sweep ${sweep.id} re-queued for gas re-check`,
      );
    }
    return stuck.length;
  }

  async ensureSweep(deposit: Deposit): Promise<DepositSweep | null> {
    const existing = await this.sweepRepo.findOne({
      where: { depositId: deposit.id },
    });
    if (existing) return existing;

    const network = this.networkRegistry.getNetworkByChainId(deposit.chainId);
    const destination = (
      network?.treasuryAddress ||
      this.configService.get<string>('DEPOSIT_TREASURY_ADDRESS') ||
      ''
    ).trim();

    const base = {
      depositId: deposit.id,
      chainId: deposit.chainId,
      assetSymbol: 'USDT',
      tokenAddress: this.tokenRegistry.getToken('USDT', deposit.chainId).contract,
      amount: deposit.usdtAmount,
    };

    if (!destination) {
      const manual = this.sweepRepo.create({
        ...base,
        depositAddressId: null,
        destinationAddress: '',
        status: DepositSweepStatus.MANUAL_REVIEW,
        failureReason: 'DEPOSIT_TREASURY_ADDRESS is not configured',
      });
      await this.sweepRepo.save(manual);
      return manual;
    }

    let addressEntity: DepositAddress | null = null;
    if (deposit.depositAddress) {
      addressEntity = await this.addressService.findByAddressAndChainId(
        deposit.depositAddress,
        deposit.chainId,
      );
    }

    const sweep = this.sweepRepo.create({
      ...base,
      depositAddressId: addressEntity?.id ?? null,
      destinationAddress: destination,
      status: DepositSweepStatus.PENDING,
    });
    await this.sweepRepo.save(sweep);

    await this.sweepQueue.add(
      'process-sweep',
      { sweepId: sweep.id },
      {
        jobId: `sweep-${sweep.id}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return sweep;
  }

  async getById(id: string): Promise<DepositSweep> {
    const sweep = await this.sweepRepo.findOne({ where: { id } });
    if (!sweep) throw new Error('Sweep not found');
    return sweep;
  }

  async listRecent(limit = 200): Promise<DepositSweep[]> {
    return this.sweepRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  private sweepEnabled(): boolean {
    return (
      this.configService.get<string>('DEPOSIT_SWEEP_ENABLED') === 'true'
    );
  }

  /**
   * Execute (or recover) an EVM sweep with crash-safe, deterministic identity.
   *
   * State routing:
   *   PENDING      -> executeNewSweep (validate, sign, persist BROADCASTING, broadcast).
   *   BROADCASTING -> recoverSweep (tx hash + signed raw tx already persisted).
   *   SUBMITTED    -> confirmSweep (defensive; should not normally reach here).
   *   terminal     -> return.
   *
   * The crash window (broadcast before SUBMITTED persistence) is closed by:
   *   1. Signing the tx and computing its DETERMINISTIC hash (keccak256 of the
   *      signed raw tx) BEFORE broadcasting.
   *   2. Persisting status=BROADCASTING + sweepTxHash + signedTxRaw BEFORE the
   *      broadcast RPC call.
   *   3. Recovery (recoverSweep) polls for the deterministic hash; if not found
   *      and the signed raw tx is available, it re-broadcasts the SAME signed
   *      raw tx (idempotent -> identical hash), never constructing a second,
   *      different transaction for the same sweep.
   *
   * Advisory lock + deposit_id UNIQUE guarantee concurrent workers cannot execute
   * the same sweep simultaneously.
   */
  async executeSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    const terminal = [
      DepositSweepStatus.COMPLETED,
      DepositSweepStatus.FAILED,
      DepositSweepStatus.MANUAL_REVIEW,
    ];
    if (terminal.includes(sweep.status as DepositSweepStatus)) return;

    // Custody hardening: suppress automatic sweep unless state is NORMAL,
    // unless this is a manual recovery action (SUBMITTED/BROADCASTING already
    // persisted may still need confirmation polling to resolve state).
    const state = normalizeCustodyState(
      this.configService.get<string>(CUSTODY_STATE_ENV_KEY),
    );
    const isMidFlight =
      (sweep.status === DepositSweepStatus.SUBMITTED && sweep.sweepTxHash) ||
      (sweep.status === DepositSweepStatus.BROADCASTING && sweep.sweepTxHash);

    // Mid-flight sweeps (already persisted a hash) can be recovered even in
    // lockdown to resolve their terminal state — but never start a NEW sweep.
    if (!isAutomaticSweepAllowed(state) && !isMidFlight) {
      this.logger.warn(
        `Sweep ${sweepId} (status=${sweep.status}) not executed: custody state is ${state}`,
      );
      return;
    }

    // Already broadcast + hash known -> poll for confirmation.
    if (sweep.status === DepositSweepStatus.SUBMITTED && sweep.sweepTxHash) {
      await this.confirmSweep(sweepId);
      return;
    }

    // Mid-flight after a crash: signed raw tx + hash already persisted.
    if (isMidFlight) {
      await this.recoverSweep(sweepId);
      return;
    }

    // PENDING -> first attempt at this sweep.
    // GAS_REQUIRED -> recovery: gas was insufficient at the previous attempt
    // (nothing signed/broadcast), re-enter the normal path which re-checks
    // gas and either parks again or proceeds to sign/broadcast.
    // Refuse for compromised addresses.
    if (sweep.depositAddressId) {
      const compromised = await this.addressService.isCompromised(
        sweep.depositAddressId,
      );
      if (compromised) {
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          'Source deposit address is COMPROMISED; sweep suspended pending manual recovery',
        );
        return;
      }
    }

    await this.executeNewSweep(sweepId);
  }

  /**
   * Recover a sweep left in BROADCASTING after a crash/restart.
   *
   * Safe because the deterministic tx hash is already persisted. We either find
   * the transaction on-chain (it was broadcast) or safely re-broadcast the SAME
   * signed raw tx (same hash -> idempotent). We NEVER build a new transaction.
   */
  async recoverSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (sweep.status !== DepositSweepStatus.BROADCASTING) return;
    if (!sweep.sweepTxHash) {
      // Ambiguous: BROADCASTING without a hash. Cannot safely proceed.
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Recovery: BROADCASTING sweep has no transaction hash',
      );
      return;
    }

    const deposit = await this.depositRepo.findOne({
      where: { id: sweep.depositId ?? '' },
    });
    if (!deposit) {
      await this.mark(
        sweep,
        DepositSweepStatus.FAILED,
        'Deposit not found during sweep recovery',
      );
      return;
    }

    const network = this.networkRegistry.getNetworkByChainId(deposit.chainId);
    if (!network || network.protocol !== 'EVM') {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Recovery: network no longer EVM-configured',
      );
      return;
    }

    // Advisory lock so recovery cannot race another execution of the same sweep.
    await this.dataSource.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`sweep-recover-${sweep.id}`],
    );

    try {
      const adapter = this.chainRegistry.getAdapter(deposit.chainId);

      // Case A: the deterministic hash is already on-chain -> just confirm.
      const existing = await adapter.getTransactionReceipt(sweep.sweepTxHash);
      if (existing) {
        sweep.status = DepositSweepStatus.SUBMITTED;
        sweep.failureReason = null;
        sweep.submittedAt = sweep.submittedAt ?? new Date();
        await this.sweepRepo.save(sweep);
        await this.enqueueConfirm(sweep.id);
        return;
      }

      // Case B: not on-chain. Re-broadcast the SAME signed raw tx if available.
      if (sweep.signedTxRaw) {
        let broadcastHash: string;
        try {
          broadcastHash = await adapter.sendRawTransaction(sweep.signedTxRaw);
        } catch (error) {
          // RPC timeout / connection reset after a rebroadcast attempt is
          // ambiguous -> do not retry, surface for manual review.
          await this.mark(
            sweep,
            DepositSweepStatus.MANUAL_REVIEW,
            `Recovery rebroadcast failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }

        // The rebroadcast MUST yield the SAME deterministic hash.
        if (broadcastHash && broadcastHash !== sweep.sweepTxHash) {
          await this.mark(
            sweep,
            DepositSweepStatus.MANUAL_REVIEW,
            `Recovery rebroadcast produced unexpected hash ${broadcastHash} (expected ${sweep.sweepTxHash})`,
          );
          return;
        }

        sweep.status = DepositSweepStatus.SUBMITTED;
        sweep.failureReason = null;
        sweep.submittedAt = sweep.submittedAt ?? new Date();
        await this.sweepRepo.save(sweep);
        await this.enqueueConfirm(sweep.id);
        return;
      }

      // Case C: BROADCASTING + hash but no signed raw tx (legacy/ambiguous).
      // Cannot safely rebroadcast -> manual review.
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Recovery: no signed raw tx available to rebroadcast',
      );
    } catch (error) {
      if (sweep.status === DepositSweepStatus.BROADCASTING) {
        sweep.failureReason =
          error instanceof Error ? error.message : String(error);
        await this.sweepRepo.save(sweep);
      }
      throw error;
    }
  }

  /**
   * First-attempt execution of a PENDING EVM sweep (validation + gas check).
   * Signs, persists BROADCASTING, broadcasts, and marks SUBMITTED are split
   * across executeNewSweepSign and executeNewSweepFinish to stay within edit
   * size limits. Advisory lock + deposit_id UNIQUE prevent concurrent execution.
   */
  /**
   * Statuses from which the sweep may (re-)enter the normal execution path.
   *
   * A GAS_REQUIRED sweep has NEVER signed or broadcast (no tx hash, no signed
   * raw tx persisted), so re-running the gas pre-check + hardened execution
   * path is exactly as safe as running a PENDING sweep for the first time.
   * This is what allows a sweep to resume once gas arrives later, after a
   * process restart, or after the original queue job was consumed.
   */
  private isExecutableStatus(status: string): boolean {
    return (
      status === DepositSweepStatus.PENDING ||
      status === DepositSweepStatus.GAS_REQUIRED
    );
  }

  private async executeNewSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (!this.isExecutableStatus(sweep.status)) return;

    const deposit = await this.depositRepo.findOne({
      where: { id: sweep.depositId ?? '' },
    });
    if (!deposit) {
      await this.mark(sweep, DepositSweepStatus.FAILED, 'Deposit not found');
      return;
    }

    const addressEntity = deposit.depositAddress
      ? await this.addressService.findByAddressAndChainId(
          deposit.depositAddress,
          deposit.chainId,
        )
      : null;

    const from = deposit.depositAddress;

    if (!this.sweepEnabled() || !this.signer.canSign() || !from) {
      if (!from) {
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          'Deposit address missing',
        );
      } else if (this.addressService.isDevelopment()) {
        sweep.status = DepositSweepStatus.COMPLETED;
        sweep.sweepTxHash = null;
        sweep.confirmedAt = new Date();
        sweep.failureReason = null;
        this.logger.log(
          `Simulated sweep for deposit ${deposit.id} (dev provider)`,
        );
        await this.sweepRepo.save(sweep);
      } else {
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          'Sweep signing is not configured',
        );
      }
      return;
    }

    const network = this.networkRegistry.getNetworkByChainId(deposit.chainId);
    if (network?.protocol === 'TRON') {
      await this.tronSweepService.executeTronSweep(sweepId);
      return;
    }
    if (network?.protocol === 'SOLANA') {
      await this.solanaSweepService.executeSolanaSweep(sweepId);
      return;
    }
    if (!network || network.protocol !== 'EVM') {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        'Sweep for unsupported network requires its protocol custody signer (not configured)',
      );
      return;
    }

    const adapter = this.chainRegistry.getAdapter(deposit.chainId);
    const configuredToken = network.usdtContract;
    // Token identity must match what was recorded at sweep creation: if the
    // USDT config changed between ensureSweep and execution, refuse to sweep
    // with the new contract (same rule as treasury: never trust stale config).
    if (
      sweep.tokenAddress &&
      configuredToken &&
      sweep.tokenAddress.toLowerCase() !== configuredToken.toLowerCase()
    ) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        `Token contract changed since sweep creation: recorded ${sweep.tokenAddress}, configured ${configuredToken}`,
      );
      return;
    }
    const requiredRaw = BigInt(deposit.amount || '0');
    if (requiredRaw <= 0n) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        `Invalid deposit amount for sweep: ${deposit.amount}`,
      );
      return;
    }
    try {
      if (typeof adapter.getTokenBalance !== 'function') {
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          'Adapter cannot read source token balance',
        );
        return;
      }
      const sourceBalance = await adapter.getTokenBalance(configuredToken, from);
      if (sourceBalance < requiredRaw) {
        await this.mark(
          sweep,
          DepositSweepStatus.MANUAL_REVIEW,
          `Insufficient source USDT balance ${sourceBalance} < ${requiredRaw}`,
        );
        return;
      }
    } catch (error) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        `Source balance check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    const treasury = this.resolveTreasury(network);
    const treasuryError = this.validateTreasury(
      treasury,
      configuredToken,
      network,
      from,
    );
    if (treasuryError) {
      await this.mark(sweep, DepositSweepStatus.MANUAL_REVIEW, treasuryError);
      return;
    }

    const gasLimit = BigInt(
      this.configService.get<string>('DEPOSIT_SWEEP_GAS_LIMIT') ?? '100000',
    );
    const gasPrice = await adapter.getGasPrice();
    const requiredWei = gasLimit * (gasPrice > 0n ? gasPrice : 1n);
    const native = await adapter.getNativeBalance(from);
    if (native < requiredWei) {
      sweep.status = DepositSweepStatus.GAS_REQUIRED;
      sweep.failureReason = `Insufficient native balance ${native} < ${requiredWei}`;
      await this.sweepRepo.save(sweep);
      await this.gasFunding.fundIfNeeded({
        chainId: deposit.chainId,
        address: from,
        requiredWei,
      });
      throw new Error('Insufficient gas — retrying after funding window');
    }

    // Sign + persist BROADCASTING before broadcast, then broadcast + SUBMITTED.
    try {
      const signResult = await this.executeNewSweepSign(
        sweepId,
        adapter,
        deposit,
        from,
        addressEntity,
        configuredToken,
        treasury,
      );
      if (signResult) {
        await this.executeNewSweepFinish(
          sweepId,
          signResult.signedTx,
          signResult.hash,
        );
      }
    } catch (error) {
      // Record the failure reason for observability. Status is intentionally
      // left as-is: PENDING (nothing broadcast — safe to retry with a fresh
      // sign) or BROADCASTING (broadcast ambiguous — recovery handles it).
      // Only non-recoverable validation failures above set MANUAL_REVIEW and
      // return without throwing.
      if (
        sweep.status === DepositSweepStatus.PENDING ||
        sweep.status === DepositSweepStatus.GAS_REQUIRED ||
        sweep.status === DepositSweepStatus.BROADCASTING
      ) {
        sweep.failureReason =
          error instanceof Error ? error.message : String(error);
        await this.sweepRepo.save(sweep);
      }
      throw error;
    }
  }

  /**
   * Sign the sweep tx and persist BROADCASTING + the deterministic tx hash and
   * the signed raw tx BEFORE broadcasting. Runs under the advisory lock. A crash
   * after this point is recoverable: recovery either finds the deterministic
   * hash on-chain or re-broadcasts the SAME signed raw tx (idempotent).
   */
  private async executeNewSweepSign(
    sweepId: string,
    adapter: any,
    deposit: Deposit,
    from: string,
    addressEntity: any,
    configuredToken: string,
    treasury: string,
  ): Promise<{ hash: string; signedTx: string } | null> {
    const sweep = await this.getById(sweepId);

    await this.dataSource.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`sweep-exec-${sweep.id}`],
    );

    const fresh = await this.getById(sweepId);
    if (!this.isExecutableStatus(fresh.status)) return null;

    const nonce = await adapter.getNonce(from);
    const signed = await this.signer.signTokenTransfer({
      chainId: deposit.chainId,
      from,
      to: treasury,
      tokenAddress: configuredToken,
      amountWei: deposit.amount,
      derivationIndex: addressEntity?.derivationIndex ?? undefined,
      nonce,
      gasLimit: (
        this.configService.get<string>('DEPOSIT_SWEEP_GAS_LIMIT') ?? '100000'
      ).toString(),
      gasPrice: (await adapter.getGasPrice()).toString(),
    });

    const deterministicHash = keccak256(signed.signedTransaction);

    sweep.status = DepositSweepStatus.BROADCASTING;
    sweep.sweepTxHash = deterministicHash;
    sweep.signedTxRaw = signed.signedTransaction;
    sweep.submittedAt = new Date();
    sweep.destinationAddress = treasury;
    sweep.failureReason = null;
    await this.sweepRepo.save(sweep);

    return { hash: deterministicHash, signedTx: signed.signedTransaction };
  }

  /**
   * Broadcast the signed tx and mark SUBMITTED. Called AFTER BROADCASTING is
   * persisted, so a crash/timeout in the broadcast RPC leaves the sweep in a
   * recoverable BROADCASTING state (never a blind retry with a new nonce).
   */
  private async executeNewSweepFinish(
    sweepId: string,
    signedTx: string,
    expectedHash: string,
  ): Promise<void> {
    const sweep = await this.getById(sweepId);
    if (sweep.status !== DepositSweepStatus.BROADCASTING) return;

    const adapter = this.chainRegistry.getAdapter(sweep.chainId);

    let broadcastHash: string;
    try {
      broadcastHash = await adapter.sendRawTransaction(signedTx);
    } catch (error) {
      // Timeout / connection reset / unknown result AFTER we may have
      // broadcast -> leave as BROADCASTING for safe recovery. Never retry here.
      this.logger.warn(
        `Sweep ${sweep.id} broadcast threw (left BROADCASTING for recovery): ${error instanceof Error ? error.message : String(error)}`,
      );
      sweep.failureReason =
        error instanceof Error ? error.message : String(error);
      await this.sweepRepo.save(sweep);
      throw error;
    }

    // The broadcast MUST yield the SAME deterministic hash.
    if (broadcastHash && broadcastHash !== expectedHash) {
      await this.mark(
        sweep,
        DepositSweepStatus.MANUAL_REVIEW,
        `Broadcast produced unexpected hash ${broadcastHash} (expected ${expectedHash})`,
      );
      return;
    }

    sweep.status = DepositSweepStatus.SUBMITTED;
    sweep.failureReason = null;
    await this.sweepRepo.save(sweep);

    await this.enqueueConfirm(sweep.id);
  }

  async confirmSweep(sweepId: string): Promise<void> {
    const sweep = await this.getById(sweepId);
    const terminal = [
      DepositSweepStatus.COMPLETED,
      DepositSweepStatus.FAILED,
      DepositSweepStatus.MANUAL_REVIEW,
    ];
    if (terminal.includes(sweep.status as DepositSweepStatus)) return;
    if (!sweep.sweepTxHash) {
      throw new Error('Sweep has no transaction hash');
    }

    const sweepNetwork = this.networkRegistry.getNetworkByChainId(sweep.chainId);
    if (sweepNetwork?.protocol === 'TRON') {
      await this.tronSweepService.confirmTronSweep(sweepId);
      return;
    }
    if (sweepNetwork?.protocol === 'SOLANA') {
      await this.solanaSweepService.confirmSolanaSweep(sweepId);
      return;
    }

    const adapter = this.chainRegistry.getAdapter(sweep.chainId);
    const receipt = await adapter.getTransactionReceipt(sweep.sweepTxHash);
    if (!receipt) {
      throw new Error('Sweep receipt not found');
    }

    if (receipt.status === 1) {
      sweep.status = DepositSweepStatus.COMPLETED;
      sweep.confirmedAt = new Date();
      sweep.failureReason = null;
      await this.sweepRepo.save(sweep);
    } else if (receipt.status === 0) {
      sweep.status = DepositSweepStatus.FAILED;
      sweep.failureReason = 'Sweep transaction reverted';
      await this.sweepRepo.save(sweep);
    } else {
      throw new Error('Sweep not mined yet');
    }
  }

  /** Persist a status change + failure reason on a sweep record. */
  private async mark(
    sweep: DepositSweep,
    status: DepositSweepStatus,
    failureReason: string | null,
  ): Promise<void> {
    sweep.status = status;
    sweep.failureReason = failureReason;
    await this.sweepRepo.save(sweep);
  }

  /** Load the server-side treasury for a network (never cached, never user input). */
  private resolveTreasury(network: {
    id?: string;
    treasuryAddress?: string;
  }): string {
    const perNetworkKey = `${(network.id ?? '').toUpperCase()}_TREASURY_ADDRESS`;
    return (
      (network.treasuryAddress || '').trim() ||
      (this.configService.get<string>(perNetworkKey) || '').trim() ||
      (this.configService.get<string>('DEPOSIT_TREASURY_ADDRESS') || '').trim()
    );
  }

  /**
   * Validate the treasury before signing. Returns an error string if invalid,
   * or null if valid. Server-controlled only — no user input can enter here.
   */
  private validateTreasury(
    treasury: string,
    configuredToken: string,
    network: { chainId?: number | null; protocol?: string },
    source: string,
  ): string | null {
    if (!treasury) {
      return 'Treasury address is not configured';
    }
    try {
      const checksummed = this.checksumAddress(treasury);
      if (checksummed !== treasury) {
        return `Treasury address failed checksum validation: ${treasury}`;
      }
    } catch {
      return `Treasury address is not a valid EVM address: ${treasury}`;
    }
    if (treasury.toLowerCase() === (source || '').toLowerCase()) {
      return 'Treasury address equals the source deposit address';
    }
    if (!configuredToken) {
      return 'Configured USDT contract is missing for this network';
    }
    if (!network || network.protocol !== 'EVM' || network.chainId == null) {
      return 'Network is not configured as EVM';
    }
    return null;
  }

  private checksumAddress(address: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAddress } = require('ethers');
    return getAddress(address);
  }

  private async enqueueConfirm(sweepId: string): Promise<void> {
    await this.confirmQueue.add(
      'confirm-sweep',
      { sweepId },
      {
        jobId: `confirm-sweep-${sweepId}`,
        attempts: 20,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
