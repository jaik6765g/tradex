// backend/src/modules/withdrawals/withdrawals.service.ts

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { Balance } from '../balances/balance.entity';
import {
  BlockchainService,
  WITHDRAWAL_VAULT_MAX_BATCH_SIZE,
} from '../blockchain/blockchain.service';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { WalletsService } from '../wallets/wallets.service';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { AdminSetting } from '../admin/entities/admin-setting.entity';
import { WageringService } from '../wagering/wagering.service';
import { WalletSourceService } from '../wagering/wallet-source.service';
import {
  DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
  DailyWithdrawalFrequency,
  getIstDayWindow,
  LimitsService,
} from '../limits/limits.service';

// ============================================================
// PER-USER ADVISORY LOCK (Architecture Plan v3, correction 1)
// ============================================================
//
// `SELECT ... FOR UPDATE` over existing withdrawal rows cannot serialize a
// user with ZERO withdrawal rows (nothing is locked), so concurrent first
// requests could both pass the daily-limit count. The daily-frequency check
// therefore serializes on a PostgreSQL TRANSACTION-SCOPED advisory lock
// keyed by userId, acquired as the FIRST statement of the createWithdrawal
// transaction. Concurrent requests block on the lock; each re-counts under
// the lock; releases automatically on COMMIT/ROLLBACK (no leaks).
//
// Two-key form: (NAMESPACE, hash32(userId)).
// - NAMESPACE is a reserved constant so this lock family never collides
//   with any other advisory-lock usage in this database. Any future
//   advisory-lock usage MUST register its own distinct namespace here.
// - hash32 maps the userId UUID to an int32 deterministically. Two distinct
//   users colliding on hash32 is harmless for correctness (they would only
//   momentarily serialize); correctness never depends on collision-freeness.
const WITHDRAWAL_DAILY_LIMIT_LOCK_NAMESPACE = 0x5458444c; // 'TXDL' (int32-safe)

/** Deterministic int32 key from a UUID (first 8 hex chars -> uint32). */
export function withdrawalDailyLimitLockKeys(userId: string): [number, number] {
  const hash32 = parseInt(userId.replace(/-/g, '').slice(0, 8), 16) >>> 0;
  // Map uint32 into signed int32 range required by Postgres int arguments.
  const signed = hash32 > 0x7fffffff ? hash32 - 0x100000000 : hash32;
  return [WITHDRAWAL_DAILY_LIMIT_LOCK_NAMESPACE, signed];
}

/**
 * Lifecycle statuses that CONSUME the daily withdrawal quota: every
 * successfully created / accepted withdrawal (REQUESTED through COMPLETED,
 * including those awaiting admin approval) EXCEPT REJECTED / FAILED /
 * CANCELLED (Architecture Plan v3, decision 3).
 */
const DAILY_COUNT_EXCLUDED_STATUSES = [
  WithdrawalStatus.REJECTED,
  WithdrawalStatus.FAILED,
  WithdrawalStatus.CANCELLED,
];


const ACTIVE_STATUSES = [
  WithdrawalStatus.REQUESTED,
  WithdrawalStatus.RISK_CHECKING,
  WithdrawalStatus.LIQUIDITY_CHECK,
  WithdrawalStatus.PENDING_ADMIN_APPROVAL,
  WithdrawalStatus.APPROVED,
  WithdrawalStatus.QUEUED,
  WithdrawalStatus.PROCESSING,
  WithdrawalStatus.SENT,
  WithdrawalStatus.HOLD,
];

/**
 * Statuses that BLOCK a new withdrawal for the same user. Every non-terminal
 * lifecycle status — including APPROVED, HOLD, QUEUED, PROCESSING and SENT —
 * represents funds still reserved for an in-flight payout, so a second
 * withdrawal must not be created while any of them exists. Only the
 * explicitly terminal REJECTED / FAILED / CANCELLED statuses are excluded.
 *
 * (Previously only the first four were treated as blocking, which let a user
 * open a second withdrawal while a first was APPROVED or on HOLD.)
 */
const BLOCKING_STATUSES = [
  WithdrawalStatus.REQUESTED,
  WithdrawalStatus.RISK_CHECKING,
  WithdrawalStatus.LIQUIDITY_CHECK,
  WithdrawalStatus.PENDING_ADMIN_APPROVAL,
  WithdrawalStatus.APPROVED,
  WithdrawalStatus.QUEUED,
  WithdrawalStatus.PROCESSING,
  WithdrawalStatus.SENT,
  WithdrawalStatus.HOLD,
];

/** Canonical shape persisted on a withdrawal for its FIFO source legs. */
interface SourceAllocationLeg {
  bucketId: string;
  sourceType: string;
  amount: string;
}

interface SourceAllocationSnapshot {
  legs: SourceAllocationLeg[];
  reservedAt: string;
}


// Daily-withdrawal-frequency key/defaults live in LimitsService
// (`maxWithdrawalsPerUserPerDay`), the single source of truth for limits.
interface CountVolumeMetric {
  count: number;
  volume: string;
}

interface WithdrawalVaultSnapshot {
  balance: string | null;
  symbol: 'USDT';
  chainId: number | null;
  address: string | null;
  tokenAddress: string | null;
  fetchedAt: string;
  available: boolean;
  error?: string;
}

export interface WithdrawalAdminStatistics {
  total: CountVolumeMetric;
  today: CountVolumeMetric;
  statuses: {
    requested: number;
    riskChecking: number;
    liquidityCheck: number;
    pendingAdminApproval: number;
    approved: number;
    queued: number;
    processing: number;
    sent: number;
    completed: number;
    failed: number;
    rejected: number;
    cancelled: number;
    hold: number;
  };
  vault: WithdrawalVaultSnapshot;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepo: Repository<Withdrawal>,
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepo: Repository<AdminSetting>,
    private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
    private readonly walletsService: WalletsService,
    private readonly configService: ConfigService,
    private readonly wageringService: WageringService,
    private readonly limitsService: LimitsService,
    /**
     * FIFO source-attribution layer. Determines the withdrawable slice of the
     * authoritative balance per funding source and reserves/commits/releases
     * those attributions alongside the existing balance reserve.
     */
    private readonly walletSourceService: WalletSourceService,
  ) {}

  // ============================================================
  // USER: CREATE WITHDRAWAL
  // ============================================================

  async createWithdrawal(
    userId: string,
    walletAddress: string,
    chainId: number,
    tokenAddress: string,
    tdxAmount: string,
    clientRequestId?: string | null,
  ): Promise<Withdrawal> {
    this.validateAmount(tdxAmount);
    await this.validateWalletOwnership(userId, walletAddress, chainId);

    if (!this.blockchainService.isSupportedPayoutConfiguration(chainId, tokenAddress)) {
      throw new BadRequestException('Unsupported withdrawal chain or token');
    }

    const usdtAmount = this.decimal(tdxAmount).div(100).toFixed(18);
    if (this.decimal(usdtAmount).lte(0)) {
      throw new BadRequestException('Withdrawal amount is below token precision');
    }

    const normalizedClientRequestId = clientRequestId?.trim() || null;
    const requestedAmount = this.fixed(tdxAmount);
    const payload = {
      walletAddress,
      chainId,
      tokenAddress,
      tdxAmount: requestedAmount,
    };

    // Idempotency FAST PATH (pre-lock, performance only) and BEFORE any
    // policy re-check: a replay must return the ORIGINAL result even if
    // limits changed after the original request was accepted. The
    // authoritative replay decision is re-made INSIDE the advisory-locked
    // transaction, because a concurrent duplicate may commit while we wait.
    if (normalizedClientRequestId) {
      const replay = await this.withdrawalRepo.findOne({
        where: { userId, clientRequestId: normalizedClientRequestId },
      });
      if (replay) {
        this.assertIdempotentReplayMatches(replay, payload);
        return replay;
      }
    }

    // Min/max withdrawal limits (5 / 500 USDT defaults) — fast-fail BEFORE
    // the transaction and re-asserted inside the locked transaction below
    // (backend is the single source of truth; limits are read from the DB
    // on every enforcement call). Throws 400 WITHDRAWAL_BELOW_MINIMUM /
    // WITHDRAWAL_ABOVE_MAXIMUM with zero mutations.
    await this.limitsService.assertWithdrawalAmount(this.decimal(usdtAmount));

    let outcome: { withdrawal: Withdrawal; replayed: boolean };
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Withdrawal);

        // 1. Per-user serialization lock (transaction-scoped advisory lock),
        //    acquired as the FIRST statement of the transaction. Guarantees
        //    the idempotency re-check, the daily-frequency count+insert and
        //    the source-allocation reserve are atomic even when the user has
        //    zero withdrawal rows. Auto-released on commit/rollback.
        const [lockKey1, lockKey2] = withdrawalDailyLimitLockKeys(userId);
        await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
          lockKey1,
          lockKey2,
        ]);

        // 1b. Authoritative idempotency re-check under the lock.
        if (normalizedClientRequestId) {
          const replay = await repo.findOne({
            where: { userId, clientRequestId: normalizedClientRequestId },
          });
          if (replay) {
            this.assertIdempotentReplayMatches(replay, payload);
            return { withdrawal: replay, replayed: true };
          }
        }

        // 2. Lock the user's withdrawal rows deterministically.
        await repo
          .createQueryBuilder('w')
          .where('w.userId = :userId', { userId })
          .setLock('pessimistic_write')
          .getMany();

        const blocking = await repo.findOne({
          where: { userId, status: In(BLOCKING_STATUSES) },
        });

        if (blocking) {
          throw new ConflictException('An active withdrawal request already exists');
        }

        // 3. Daily withdrawal frequency (accepted lifecycle entries, IST day,
        //    machine-readable 409 on exceed). Runs under the advisory lock.
        await this.assertWithinDailyWithdrawalLimit(userId, manager);

        // 4. Min/max withdrawal limits — authoritative re-check inside the
        //    locked transaction (settings read fresh from the DB, no cache).
        await this.limitsService.assertWithdrawalAmount(
          this.decimal(usdtAmount),
        );

        // 5. Re-read the AUTHORITATIVE balance and lock the row. Any balance
        //    that predates source attribution (legacy/untagged) is lazily
        //    attributed to a single LEGACY bucket so it stays withdrawable
        //    and never silently disappears from eligibility calculation.
        const balance = await this.findBalanceForUpdate(manager, userId);
        await this.walletSourceService.ensureLegacyAttribution(
          userId,
          balance.availableBalance,
          manager,
        );

        // 6. Source-aware wagering enforcement. Only wagerable funds still
        //    locked by an obligation are blocked; referral commission /
        //    salary / legacy stay withdrawable while a deposit obligation is
        //    still active. Throws 403 WAGERING_WITHDRAWAL_BLOCKED.
        await this.wageringService.assertWithdrawalAllowed(
          userId,
          manager,
          requestedAmount,
        );

        const created = await repo.save(
          repo.create({
            userId,
            walletAddress,
            chainId,
            tokenAddress,
            tdxAmount: requestedAmount,
            usdtAmount: this.fixed(usdtAmount),
            fee: '0',
            status: WithdrawalStatus.REQUESTED,
            riskPassed: false,
            liquidityPassed: true,
            adminApproved: false,
            payoutAttempted: false,
            clientRequestId: normalizedClientRequestId ?? undefined,
            metadata: {
              withdrawalFlow: 'ADMIN_METAMASK_PAYOUT',
              liquidityCheck: 'NOT_REQUIRED_AT_REQUEST',
            },
          }),
        );

        // 7. Reserve the FIFO source attribution FIRST, then the balance
        //    reserve. Both happen inside this transaction, so if either fails
        //    the withdrawal rolls back and no attribution is consumed.
        const legs = await this.walletSourceService.reserveFifo(
          userId,
          requestedAmount,
          manager,
        );
        await this.reserve(manager, created);

        created.metadata = {
          ...(created.metadata ?? {}),
          sourceAllocation: {
            legs,
            reservedAt: new Date().toISOString(),
          } as SourceAllocationSnapshot,
        };
        created.status = WithdrawalStatus.RISK_CHECKING;
        return { withdrawal: await repo.save(created), replayed: false };
      });
    } catch (error) {
      // Concurrent duplicate: the unique (userId, clientRequestId) index won
      // the race. Return the committed original instead of a second row.
      if (
        normalizedClientRequestId &&
        this.isClientRequestUniqueViolation(error)
      ) {
        const replay = await this.withdrawalRepo.findOne({
          where: { userId, clientRequestId: normalizedClientRequestId },
        });
        if (replay) {
          this.assertIdempotentReplayMatches(replay, payload);
          return replay;
        }
      }
      throw error;
    }

    const withdrawal = outcome.withdrawal;
    if (outcome.replayed) {
      return withdrawal;
    }

    const riskResult = this.runRiskChecks(walletAddress, chainId, tokenAddress);
    if (!riskResult.passed) {
      return this.rejectBeforeBroadcast(
        withdrawal.id,
        WithdrawalStatus.REJECTED,
        riskResult.reason,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const locked = await this.findWithdrawalForUpdate(repo, withdrawal.id);

      if (locked.status !== WithdrawalStatus.RISK_CHECKING) {
        return locked;
      }

      locked.riskPassed = true;
      locked.liquidityPassed = true;
      locked.status = WithdrawalStatus.PENDING_ADMIN_APPROVAL;
      locked.rejectionReason = undefined;
      locked.riskReason = undefined;
      locked.metadata = {
        ...(locked.metadata ?? {}),
        risk: { result: 'PASS', checkedAt: new Date().toISOString() },
        liquidityCheck: {
          required: false,
          reason: 'Platform vault liquidity is not used for admin MetaMask payout',
        },
      };

      return repo.save(locked);
    });
  }

  // ============================================================
  // ADMIN: APPROVE
  // ============================================================

  async approveWithdrawal(
    withdrawalId: string,
    adminId: string,
    payoutWalletAddress: string,
    note?: string,
  ): Promise<Withdrawal> {
    this.validateEvmAddress(payoutWalletAddress, 'Invalid payout wallet address');

    const candidate = await this.getWithdrawalById(withdrawalId);

    if (this.isPayoutStage(candidate.status)) {
      return candidate;
    }

    if (candidate.status !== WithdrawalStatus.PENDING_ADMIN_APPROVAL) {
      throw new BadRequestException(
        `Withdrawal is not awaiting admin approval. Current status: ${candidate.status}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (this.isPayoutStage(withdrawal.status)) {
        return withdrawal;
      }

      if (withdrawal.status !== WithdrawalStatus.PENDING_ADMIN_APPROVAL) {
        throw new BadRequestException(
          `Withdrawal is not awaiting admin approval. Current status: ${withdrawal.status}`,
        );
      }

      if (!this.blockchainService.isSupportedPayoutConfiguration(
        withdrawal.chainId,
        withdrawal.tokenAddress,
      )) {
        throw new BadRequestException('Withdrawal chain or token configuration is no longer supported');
      }

      this.validateEvmAddress(withdrawal.walletAddress, 'Withdrawal recipient wallet is invalid');
      this.validateEvmAddress(payoutWalletAddress, 'Admin payout wallet is invalid');

      if (this.decimal(withdrawal.usdtAmount).lte(0)) {
        throw new BadRequestException('Withdrawal USDT amount is invalid');
      }

      withdrawal.payoutWalletAddress = payoutWalletAddress;
      withdrawal.adminApproved = true;
      withdrawal.approvedBy = adminId;
      withdrawal.approvedAt = new Date();
      withdrawal.status = WithdrawalStatus.APPROVED;
      withdrawal.rejectionReason = undefined;

      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        withdrawalFlow: 'ADMIN_METAMASK_PAYOUT',
        approval: {
          approvedBy: adminId,
          approvedAt: withdrawal.approvedAt.toISOString(),
          payoutWalletAddress,
          ...(note ? { adminNote: note } : {}),
        },
        payout: {
          mode: 'ADMIN_METAMASK',
          backendPrivateKey: false,
          queue: false,
        },
      };

      return repo.save(withdrawal);
    });
  }

  // ============================================================
  // ADMIN: REJECT
  // ============================================================

  async rejectWithdrawal(
    withdrawalId: string,
    reason: string,
    adminId?: string,
  ): Promise<Withdrawal> {
    return this.rejectBeforeBroadcast(
      withdrawalId,
      WithdrawalStatus.REJECTED,
      reason || 'Rejected by admin',
      adminId,
    );
  }

  // ============================================================
  // ADMIN: RELEASE HOLD
  // ============================================================

  async releaseHold(withdrawalId: string): Promise<Withdrawal> {
    const candidate = await this.getWithdrawalById(withdrawalId);

    if (candidate.status !== WithdrawalStatus.HOLD) {
      throw new BadRequestException(
        `Withdrawal is not on hold. Current status: ${candidate.status}`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (withdrawal.status !== WithdrawalStatus.HOLD) {
        return withdrawal;
      }

      withdrawal.status = WithdrawalStatus.PENDING_ADMIN_APPROVAL;
      withdrawal.riskPassed = true;
      withdrawal.liquidityPassed = true;
      withdrawal.rejectionReason = undefined;

      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        hold: { released: true, releasedAt: new Date().toISOString() },
        liquidityCheck: {
          required: false,
          reason: 'Admin MetaMask payout liquidity is determined by connected wallet transaction',
        },
      };

      return repo.save(withdrawal);
    });
  }

  // ============================================================
  // ADMIN: REVALIDATE STUCK APPROVED PAYOUT
  // ============================================================

  async revalidateApprovedPayout(
    withdrawalId: string,
    adminId: string,
  ): Promise<Withdrawal> {
    const candidate = await this.getWithdrawalById(withdrawalId);

    if (candidate.status !== WithdrawalStatus.APPROVED) {
      throw new BadRequestException(
        `Only APPROVED withdrawals can be revalidated. Current status: ${candidate.status}`,
      );
    }

    if (this.hasPayoutEvidence(candidate)) {
      throw new ConflictException(
        'Payout evidence exists; reconcile blockchain transaction before changing withdrawal state',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (withdrawal.status !== WithdrawalStatus.APPROVED) {
        throw new BadRequestException(
          `Only APPROVED withdrawals can be revalidated. Current status: ${withdrawal.status}`,
        );
      }

      if (this.hasPayoutEvidence(withdrawal)) {
        throw new ConflictException(
          'Payout evidence exists; reconcile blockchain transaction before changing withdrawal state',
        );
      }

      withdrawal.status = WithdrawalStatus.PENDING_ADMIN_APPROVAL;
      withdrawal.adminApproved = false;
      withdrawal.approvedBy = undefined;
      withdrawal.approvedAt = undefined;
      withdrawal.processedAt = undefined;

      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        payoutRecovery: {
          action: 'REVALIDATE_APPROVED_TO_PENDING_ADMIN_APPROVAL',
          previousStatus: WithdrawalStatus.APPROVED,
          nextStatus: WithdrawalStatus.PENDING_ADMIN_APPROVAL,
          recoveredBy: adminId,
          recoveredAt: new Date().toISOString(),
          txHashPresent: false,
          payoutAttempted: false,
          reserveState: 'LOCKED_PRESERVED',
          refundTriggered: false,
          blockchainTransferTriggered: false,
        },
      };

      return repo.save(withdrawal);
    });
  }

  // ============================================================
  // ADMIN: PROCESS / PREPARE PAYOUT STATE
  // ============================================================

  async processWithdrawal(withdrawalId: string): Promise<Withdrawal> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (withdrawal.status === WithdrawalStatus.COMPLETED) {
        return withdrawal;
      }

      if (
        withdrawal.status === WithdrawalStatus.QUEUED ||
        withdrawal.status === WithdrawalStatus.PROCESSING ||
        withdrawal.status === WithdrawalStatus.SENT
      ) {
        return withdrawal;
      }

      if (withdrawal.status !== WithdrawalStatus.APPROVED) {
        throw new BadRequestException(
          `Withdrawal is not approved for blockchain payout. Current status: ${withdrawal.status}`,
        );
      }

      if (!withdrawal.payoutWalletAddress) {
        throw new BadRequestException('Approved payout wallet is missing');
      }

      if (!this.blockchainService.isSupportedPayoutConfiguration(
        withdrawal.chainId,
        withdrawal.tokenAddress,
      )) {
        throw new BadRequestException('Withdrawal chain or token configuration is invalid');
      }

      withdrawal.processedAt = new Date();
      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        payout: {
          ...(typeof withdrawal.metadata?.payout === 'object' ? withdrawal.metadata.payout : {}),
          state: 'READY_FOR_METAMASK',
          preparedAt: new Date().toISOString(),
        },
      };

      return repo.save(withdrawal);
    });
  }

  async startProcessing(withdrawalId: string): Promise<Withdrawal> {
    return this.processWithdrawal(withdrawalId);
  }

  // ============================================================
  // ADMIN: COMPLETE / VERIFY BLOCKCHAIN PAYOUT
  // ============================================================

  async completeWithdrawal(
    withdrawalId: string,
    txHash: string,
  ): Promise<Withdrawal> {
    return this.confirmWithdrawal(withdrawalId, txHash);
  }

  async confirmWithdrawal(
    withdrawalId: string,
    txHash: string,
  ): Promise<Withdrawal> {
    if (typeof txHash !== 'string' || !txHash.trim()) {
      throw new BadRequestException('Transaction hash is required');
    }

    const normalizedTxHash = txHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new BadRequestException('Transaction hash must be a valid 0x-prefixed 32-byte hash');
    }

    const existing = await this.getWithdrawalById(withdrawalId);

    if (existing.status === WithdrawalStatus.COMPLETED) {
      return existing;
    }

    if (existing.txHash && existing.txHash !== normalizedTxHash) {
      throw new ConflictException('Transaction hash does not match withdrawal');
    }

    if (!existing.payoutWalletAddress) {
      throw new BadRequestException('Approved payout wallet is missing');
    }

    if (!existing.adminApproved) {
      throw new BadRequestException('Withdrawal has not been approved by admin');
    }

    if (!this.blockchainService.isSupportedPayoutConfiguration(
      existing.chainId,
      existing.tokenAddress,
    )) {
      throw new BadRequestException('Withdrawal chain or token configuration is invalid');
    }

        const requiredConfirmations = this.getRequiredConfirmations();

        const withdrawalVaultAddress = this.blockchainService.getWithdrawalVaultAddress(existing.chainId);

    const verified = await this.blockchainService.verifyWithdrawalVaultTransfer({
      txHash: normalizedTxHash,
      chainId: existing.chainId,
      expectedVaultAddress: withdrawalVaultAddress,
      expectedRecipient: existing.walletAddress,
      expectedAmount: existing.usdtAmount,
      requiredConfirmations,
    });

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (withdrawal.status === WithdrawalStatus.COMPLETED) {
        return withdrawal;
      }

      if (withdrawal.txHash && withdrawal.txHash !== normalizedTxHash) {
        throw new ConflictException('Transaction hash does not match withdrawal');
      }

      if (!withdrawal.payoutWalletAddress) {
        throw new ConflictException('Approved payout wallet is missing');
      }

      if (!withdrawal.adminApproved) {
        throw new ConflictException('Withdrawal is not admin approved');
      }

            if (verified.chainId !== withdrawal.chainId) {
        throw new ConflictException('Verified transaction chain does not match withdrawal');
      }

      if (verified.recipient.toLowerCase() !== withdrawal.walletAddress.toLowerCase()) {
        throw new ConflictException('Verified recipient does not match withdrawal wallet');
      }

      if (!this.decimal(verified.amount).eq(this.decimal(withdrawal.usdtAmount))) {
        throw new ConflictException('Verified USDT amount does not match withdrawal amount');
      }

      withdrawal.txHash = normalizedTxHash;
      withdrawal.payoutAttempted = true;

      if (!withdrawal.payoutSubmittedAt) {
        withdrawal.payoutSubmittedAt = new Date();
      }

      withdrawal.payoutConfirmedAt = new Date();
      withdrawal.completedAt = new Date();
      withdrawal.verifiedAt = new Date();
      withdrawal.status = WithdrawalStatus.COMPLETED;

      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        payout: {
          ...(typeof withdrawal.metadata?.payout === 'object' ? withdrawal.metadata.payout : {}),
          mode: 'ADMIN_METAMASK_VAULT',
          verified: true,
          verifiedAt: new Date().toISOString(),
          vaultAddress: verified.vaultAddress,
          recipient: verified.recipient,
          tokenAddress: verified.tokenAddress,
          amount: verified.amount,
          chainId: verified.chainId,
          confirmations: verified.confirmations,
          requiredConfirmations,
          blockNumber: verified.blockNumber,
          gasUsed: verified.gasUsed,
        },
        blockchainVerification: {
          status: 'VERIFIED',
          verifiedAt: new Date().toISOString(),
        },
      };

      await this.consumeReserve(manager, withdrawal);
      return repo.save(withdrawal);
    });
  }

  // ============================================================
  // ADMIN: BATCH COMPLETE / VERIFY
  // ============================================================

  /**
   * Completes MULTIPLE withdrawals that were paid out by ONE single
   * WithdrawalVault.withdraw(recipients[], amounts[]) batch transaction.
   *
   * The backend NEVER trusts the frontend's recipient/amount claims:
   *
   *  - Every requested withdrawal is loaded from the database
   *  - Its verified wallet (withdrawal.walletAddress) and exact approved
   *    amount (withdrawal.usdtAmount) come from the DB.
   *  - The single transaction is verified independently against the
   *    configured WithdrawalVault + USDT Transfer events.
   *  - EVERY requested withdrawal must match a unique Transfer event.
   *  - All state transitions happen inside ONE atomic DB transaction.
   *
   * Idempotency:
   *
   *  - Re-submitting the SAME withdrawalIds + SAME verified txHash is
   *    safe (already COMPLETED rows are recognized and skipped).
   *  - A COMPLETED withdrawal that was paid with a DIFFERENT txHash is
   *    rejected - it can never be paid twice.
   */
  async batchCompleteWithdrawals(
    withdrawalIds: string[],
    txHash: string,
  ): Promise<{
    txHash: string;
    withdrawals: Withdrawal[];
    completedCount: number;
    alreadyCompletedCount: number;
    idempotent: boolean;
  }> {
    // ----------------------------------------------------------
    // 1. VALIDATE INPUT
    // ----------------------------------------------------------

    if (typeof txHash !== 'string' || !txHash.trim()) {
      throw new BadRequestException('Transaction hash is required');
    }

    const normalizedTxHash = txHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      throw new BadRequestException(
        'Transaction hash must be a valid 0x-prefixed 32-byte hash',
      );
    }

    if (!Array.isArray(withdrawalIds) || withdrawalIds.length === 0) {
      throw new BadRequestException(
        'At least one withdrawal ID is required for batch completion',
      );
    }

    if (withdrawalIds.length > WITHDRAWAL_VAULT_MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Batch size ${withdrawalIds.length} exceeds the maximum supported batch size of ${WITHDRAWAL_VAULT_MAX_BATCH_SIZE}`,
      );
    }

    const uniqueIds = Array.from(new Set(withdrawalIds));
    if (uniqueIds.length !== withdrawalIds.length) {
      throw new BadRequestException(
        'withdrawalIds must not contain duplicates',
      );
    }

    // ----------------------------------------------------------
    // 2. LOAD ALL REQUESTED WITHDRAWALS FROM THE DATABASE
    // ----------------------------------------------------------

    const withdrawals = await this.withdrawalRepo.find({
      where: { id: In(uniqueIds) },
    });

    if (withdrawals.length !== uniqueIds.length) {
      throw new NotFoundException(
        'One or more requested withdrawals were not found',
      );
    }

    const allOnSameChain = withdrawals.every(
      (w) => w.chainId === withdrawals[0].chainId,
    );
    if (!allOnSameChain) {
      throw new BadRequestException(
        'All withdrawals in a batch must be on the same chain',
      );
    }

    // ----------------------------------------------------------
    // 3. PRE-VALIDATE STATE (idempotency aware)
    // ----------------------------------------------------------

    const processable: Withdrawal[] = [];
    for (const withdrawal of withdrawals) {
      if (withdrawal.status === WithdrawalStatus.COMPLETED) {
        // Already completed - only idempotent when the SAME verified tx hash
        // is being re-submitted. Different txHash means a second payout.
        if (withdrawal.txHash && withdrawal.txHash !== normalizedTxHash) {
          throw new ConflictException(
            `Withdrawal ${withdrawal.id} is already completed with a different transaction hash`,
          );
        }
        continue;
      }

      if (withdrawal.status !== WithdrawalStatus.APPROVED) {
        throw new ConflictException(
          `Withdrawal ${withdrawal.id} is not APPROVED`,
        );
      }

      if (!withdrawal.adminApproved) {
        throw new ConflictException(
          `Withdrawal ${withdrawal.id} is not admin approved`,
        );
      }

      if (!withdrawal.payoutWalletAddress) {
        throw new ConflictException(
          `Approved payout wallet is missing for withdrawal ${withdrawal.id}`,
        );
      }

      if (withdrawal.txHash && withdrawal.txHash !== normalizedTxHash) {
        throw new ConflictException(
          `Transaction hash does not match withdrawal ${withdrawal.id}`,
        );
      }

      if (
        !this.blockchainService.isSupportedPayoutConfiguration(
          withdrawal.chainId,
          withdrawal.tokenAddress,
        )
      ) {
        throw new ConflictException(
          `Withdrawal ${withdrawal.id} chain or token configuration is invalid`,
        );
      }

      processable.push(withdrawal);
    }

    // All requested withdrawals were already completed with this same
    // verified transaction hash - idempotent success, nothing to re-pay.
    if (processable.length === 0) {
      this.logger.log(
        `✅ Batch completion is already completed for tx ${normalizedTxHash} (idempotent)`,
      );
      return {
        txHash: normalizedTxHash,
        withdrawals: this.orderWithdrawals(uniqueIds, withdrawals),
        completedCount: 0,
        alreadyCompletedCount: withdrawals.length,
        idempotent: true,
      };
    }

    // ----------------------------------------------------------
    // 4. INDEPENDENT BLOCKCHAIN VERIFICATION (one tx, many payouts)
    // ----------------------------------------------------------

    const requiredConfirmations = this.getRequiredConfirmations();
    const withdrawalVaultAddress =
      this.blockchainService.getWithdrawalVaultAddress(processable[0].chainId);

    // Recipients and amounts come from the DATABASE - never from the client.
    const expectedRecipients = processable.map((w) => ({
      recipient: w.walletAddress,
      amount: w.usdtAmount,
    }));

    const verified =
      await this.blockchainService.verifyWithdrawalVaultBatchTransfer({
        txHash: normalizedTxHash,
        chainId: processable[0].chainId,
        expectedVaultAddress: withdrawalVaultAddress,
        expectedRecipients,
        requiredConfirmations,
        maxBatchSize: WITHDRAWAL_VAULT_MAX_BATCH_SIZE,
      });

    // ----------------------------------------------------------
    // 5. ATOMIC DATABASE UPDATE
    // ----------------------------------------------------------

    let completedNow = 0;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);

      for (const withdrawal of processable) {
        const locked = await this.findWithdrawalForUpdate(repo, withdrawal.id);

        if (locked.status === WithdrawalStatus.COMPLETED) {
          if (locked.txHash && locked.txHash !== normalizedTxHash) {
            throw new ConflictException(
              `Withdrawal ${locked.id} is already completed with a different transaction hash`,
            );
          }
          continue;
        }

        if (locked.status !== WithdrawalStatus.APPROVED) {
          throw new ConflictException(
            `Withdrawal ${locked.id} is not APPROVED`,
          );
        }

        if (!locked.adminApproved) {
          throw new ConflictException(
            `Withdrawal ${locked.id} is not admin approved`,
          );
        }

        if (!locked.payoutWalletAddress) {
          throw new ConflictException(
            `Approved payout wallet is missing for withdrawal ${locked.id}`,
          );
        }

        if (locked.txHash && locked.txHash !== normalizedTxHash) {
          throw new ConflictException(
            `Transaction hash does not match withdrawal ${locked.id}`,
          );
        }

        if (verified.chainId !== locked.chainId) {
          throw new ConflictException(
            'Verified transaction chain does not match withdrawal',
          );
        }

        // Find the unique verified Transfer event for this withdrawal.
        const transfer = verified.transfers.find(
          (t) =>
            t.recipient.toLowerCase() === locked.walletAddress.toLowerCase(),
        );

        if (!transfer) {
          throw new ConflictException(
            `No verified payout was matched for withdrawal ${locked.id}`,
          );
        }

        if (!this.decimal(transfer.amount).eq(this.decimal(locked.usdtAmount))) {
          throw new ConflictException(
            'Verified USDT amount does not match withdrawal amount',
          );
        }

        locked.txHash = normalizedTxHash;
        locked.payoutAttempted = true;

        if (!locked.payoutSubmittedAt) {
          locked.payoutSubmittedAt = new Date();
        }

        locked.payoutConfirmedAt = new Date();
        locked.completedAt = new Date();
        locked.verifiedAt = new Date();
        locked.status = WithdrawalStatus.COMPLETED;

        locked.metadata = {
          ...(locked.metadata ?? {}),
          payout: {
            ...(typeof locked.metadata?.payout === 'object'
              ? locked.metadata.payout
              : {}),
            mode: 'ADMIN_METAMASK_VAULT',
            verified: true,
            verifiedAt: new Date().toISOString(),
            vaultAddress: verified.vaultAddress,
            recipient: transfer.recipient,
            tokenAddress: verified.tokenAddress,
            amount: transfer.amount,
            chainId: verified.chainId,
            confirmations: verified.confirmations,
            requiredConfirmations,
            blockNumber: verified.blockNumber,
            gasUsed: verified.gasUsed,
          },
          blockchainVerification: {
            status: 'VERIFIED',
            verifiedAt: new Date().toISOString(),
          },
        };

        await this.consumeReserve(manager, locked);
        await repo.save(locked);
        completedNow += 1;
      }
    });

    // ----------------------------------------------------------
    // 6. RELOAD AND RETURN
    // ----------------------------------------------------------

    const finalWithdrawals = await this.withdrawalRepo.find({
      where: { id: In(uniqueIds) },
    });

    this.logger.log(
      `✅ Batch completion verified: ${completedNow} withdrawal(s) completed in tx ${normalizedTxHash}`,
    );

    return {
      txHash: normalizedTxHash,
      withdrawals: this.orderWithdrawals(uniqueIds, finalWithdrawals),
      completedCount: completedNow,
      alreadyCompletedCount: uniqueIds.length - completedNow,
      idempotent: completedNow === 0,
    };
  }

  /** Keeps the returned withdrawals in the requested order. */
  private orderWithdrawals(ids: string[], withdrawals: Withdrawal[]): Withdrawal[] {
    const byId = new Map(withdrawals.map((w) => [w.id, w]));
    return ids
      .map((id) => byId.get(id))
      .filter((w): w is Withdrawal => Boolean(w));
  }

  // ============================================================
  // ADMIN: FAIL
  // ============================================================

  async failWithdrawal(
    withdrawalId: string,
    reason: string,
  ): Promise<Withdrawal> {
    const withdrawal = await this.getWithdrawalById(withdrawalId);

    if (withdrawal.txHash || withdrawal.payoutAttempted) {
      throw new ConflictException(
        'A blockchain payout attempt exists; reconcile the transaction before changing the withdrawal state',
      );
    }

    return this.rejectBeforeBroadcast(
      withdrawalId,
      WithdrawalStatus.FAILED,
      reason || 'Processing failed',
    );
  }

  // ============================================================
  // ADMIN: PENDING WITHDRAWALS
  // ============================================================

  async getPendingWithdrawals(): Promise<Withdrawal[]> {
    return this.withdrawalRepo.find({
      where: [
        { status: WithdrawalStatus.PENDING_ADMIN_APPROVAL },
        { status: WithdrawalStatus.APPROVED },
        { status: WithdrawalStatus.REQUESTED },
        { status: WithdrawalStatus.RISK_CHECKING },
        { status: WithdrawalStatus.LIQUIDITY_CHECK },
        { status: WithdrawalStatus.HOLD },
      ],
      order: { createdAt: 'ASC' },
    });
  }

  // ============================================================
  // ADMIN: ALL WITHDRAWALS
  // ============================================================

  async getAllWithdrawals(
    limit = 50,
    offset = 0,
    status?: WithdrawalStatus,
    search?: string,
  ): Promise<{ data: Withdrawal[]; total: number }> {
    const query = this.withdrawalRepo
      .createQueryBuilder('withdrawal')
      .orderBy('withdrawal.createdAt', 'DESC');

    if (status) {
      query.where('withdrawal.status = :status', { status });
    }

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const normalizedSearch = `%${trimmedSearch}%`;
      query.andWhere(
        '(withdrawal.id::text ILIKE :search OR withdrawal.walletAddress ILIKE :search OR withdrawal.txHash ILIKE :search OR withdrawal.payoutWalletAddress ILIKE :search)',
        { search: normalizedSearch },
      );
    }

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 50;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;

    const [data, total] = await query
      .skip(safeOffset)
      .take(safeLimit)
      .getManyAndCount();

    return { data, total };
  }

  // ============================================================
  // GET WITHDRAWAL
  // ============================================================

  async getWithdrawalById(id: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepo.findOne({ where: { id } });
    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }
    return withdrawal;
  }

  // ============================================================
  // USER: GET ONE
  // ============================================================

  async getUserWithdrawalById(userId: string, id: string): Promise<Withdrawal> {
    const withdrawal = await this.withdrawalRepo.findOne({
      where: { id, userId },
    });
    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }
    return withdrawal;
  }

  // ============================================================
  // USER: GET ALL
  // ============================================================

  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return this.withdrawalRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ============================================================
  // ADMIN STATISTICS
  // ============================================================

  async getWithdrawalStatistics(): Promise<WithdrawalAdminStatistics> {
    const aggregate = await this.withdrawalRepo
      .createQueryBuilder('withdrawal')
      .select(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :completedStatus THEN 1 ELSE 0 END), 0)`,
        'total_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :completedStatus THEN withdrawal.usdtAmount ELSE 0 END), 0)`,
        'total_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :completedStatus AND withdrawal.completedAt >= CURRENT_DATE AND withdrawal.completedAt < CURRENT_DATE + INTERVAL '1 day' THEN 1 ELSE 0 END), 0)`,
        'today_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :completedStatus AND withdrawal.completedAt >= CURRENT_DATE AND withdrawal.completedAt < CURRENT_DATE + INTERVAL '1 day' THEN withdrawal.usdtAmount ELSE 0 END), 0)`,
        'today_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :requestedStatus THEN 1 ELSE 0 END), 0)`,
        'requested_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :riskCheckingStatus THEN 1 ELSE 0 END), 0)`,
        'risk_checking_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :liquidityCheckStatus THEN 1 ELSE 0 END), 0)`,
        'liquidity_check_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :pendingAdminApprovalStatus THEN 1 ELSE 0 END), 0)`,
        'pending_admin_approval_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :approvedStatus THEN 1 ELSE 0 END), 0)`,
        'approved_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :queuedStatus THEN 1 ELSE 0 END), 0)`,
        'queued_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :processingStatus THEN 1 ELSE 0 END), 0)`,
        'processing_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :sentStatus THEN 1 ELSE 0 END), 0)`,
        'sent_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :failedStatus THEN 1 ELSE 0 END), 0)`,
        'failed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :rejectedStatus THEN 1 ELSE 0 END), 0)`,
        'rejected_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :cancelledStatus THEN 1 ELSE 0 END), 0)`,
        'cancelled_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN withdrawal.status = :holdStatus THEN 1 ELSE 0 END), 0)`,
        'hold_count',
      )
      .setParameters({
        completedStatus: WithdrawalStatus.COMPLETED,
        requestedStatus: WithdrawalStatus.REQUESTED,
        riskCheckingStatus: WithdrawalStatus.RISK_CHECKING,
        liquidityCheckStatus: WithdrawalStatus.LIQUIDITY_CHECK,
        pendingAdminApprovalStatus: WithdrawalStatus.PENDING_ADMIN_APPROVAL,
        approvedStatus: WithdrawalStatus.APPROVED,
        queuedStatus: WithdrawalStatus.QUEUED,
        processingStatus: WithdrawalStatus.PROCESSING,
        sentStatus: WithdrawalStatus.SENT,
        failedStatus: WithdrawalStatus.FAILED,
        rejectedStatus: WithdrawalStatus.REJECTED,
        cancelledStatus: WithdrawalStatus.CANCELLED,
        holdStatus: WithdrawalStatus.HOLD,
      })
      .getRawOne<{
        total_completed_count: string;
        total_completed_volume: string;
        today_completed_count: string;
        today_completed_volume: string;
        requested_count: string;
        risk_checking_count: string;
        liquidity_check_count: string;
        pending_admin_approval_count: string;
        approved_count: string;
        queued_count: string;
        processing_count: string;
        sent_count: string;
        failed_count: string;
        rejected_count: string;
        cancelled_count: string;
        hold_count: string;
      }>();

    const vault = await this.getWithdrawalVaultSnapshot();

    return {
      total: {
        count: this.toCount(aggregate?.total_completed_count),
        volume: this.toAmount(aggregate?.total_completed_volume),
      },
      today: {
        count: this.toCount(aggregate?.today_completed_count),
        volume: this.toAmount(aggregate?.today_completed_volume),
      },
      statuses: {
        requested: this.toCount(aggregate?.requested_count),
        riskChecking: this.toCount(aggregate?.risk_checking_count),
        liquidityCheck: this.toCount(aggregate?.liquidity_check_count),
        pendingAdminApproval: this.toCount(aggregate?.pending_admin_approval_count),
        approved: this.toCount(aggregate?.approved_count),
        queued: this.toCount(aggregate?.queued_count),
        processing: this.toCount(aggregate?.processing_count),
        sent: this.toCount(aggregate?.sent_count),
        completed: this.toCount(aggregate?.total_completed_count),
        failed: this.toCount(aggregate?.failed_count),
        rejected: this.toCount(aggregate?.rejected_count),
        cancelled: this.toCount(aggregate?.cancelled_count),
        hold: this.toCount(aggregate?.hold_count),
      },
      vault,
    };
  }

  // ============================================================
  // VAULT SNAPSHOT
  // ============================================================

  private async getWithdrawalVaultSnapshot(): Promise<WithdrawalVaultSnapshot> {
    const configuredChainId = this.configService.get<string>('BSC_CHAIN_ID');
    const chainId = Number(configuredChainId ?? '56');
    const normalizedChainId = Number.isInteger(chainId) && chainId > 0 ? chainId : null;

    const configuredAddress =
      this.configService.get<string>('TRADEX_WITHDRAWAL_VAULT_ADDRESS')?.trim() ||
      this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() ||
      null;

    const configuredTokenAddress = this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || null;
    const fetchedAt = new Date().toISOString();

    if (!normalizedChainId || !configuredAddress) {
      return {
        balance: null,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address: configuredAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }

    try {
      const [balance, tokenAddress] = await Promise.all([
        this.blockchainService.getUSDTBalance(configuredAddress),
        Promise.resolve(this.blockchainService.getUsdtAddress(normalizedChainId)),
      ]);

      return {
        balance,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address: configuredAddress,
        tokenAddress,
        fetchedAt,
        available: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch withdrawal vault balance: ${message}`);
      return {
        balance: null,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address: configuredAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }
  }

  // ============================================================
  // COUNT HELPERS
  // ============================================================

  private toCount(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toAmount(value: string | number | null | undefined): string {
    const raw = value === null || value === undefined ? '0' : String(value);
    return /^[-+]?\d+(\.\d+)?$/.test(raw.trim()) ? raw : '0';
  }

  // ============================================================
  // DAILY WITHDRAWAL FREQUENCY (Architecture Plan v3)
  // ============================================================
  //
  // Quota semantics (approved):
  // - Counts every successfully created / accepted withdrawal for the user
  //   in the current Asia/Kolkata calendar day: all lifecycle statuses from
  //   REQUESTED through COMPLETED, INCLUDING those awaiting admin approval.
  // - Excludes only REJECTED / FAILED / CANCELLED.
  // - Rejected validation attempts never create a row, so they can never
  //   consume quota.
  // - {"mode":"UNLIMITED"} skips the check entirely.
  //
  // Race safety: this runs inside the createWithdrawal transaction, which
  // holds the per-user transaction-scoped advisory lock (see
  // withdrawalDailyLimitLockKeys) — correct even when the user has zero
  // existing withdrawal rows.

  private async countAcceptedWithdrawalsToday(
    userId: string,
    manager: EntityManager,
    now: Date = new Date(),
  ): Promise<{ count: number; resetsAtIso: string }> {
    const repo = manager.getRepository(Withdrawal);
    const { startUtc, endUtc, resetsAtIso } = getIstDayWindow(now);

    const count = await repo
      .createQueryBuilder('w')
      .where('w.userId = :userId', { userId })
      .andWhere('w.status NOT IN (:...excluded)', {
        excluded: DAILY_COUNT_EXCLUDED_STATUSES,
      })
      .andWhere('w.createdAt >= :startUtc', { startUtc })
      .andWhere('w.createdAt < :endUtc', { endUtc })
      .getCount();

    return { count, resetsAtIso };
  }

  private async assertWithinDailyWithdrawalLimit(
    userId: string,
    manager: EntityManager,
    now: Date = new Date(),
  ): Promise<void> {
    const frequency: DailyWithdrawalFrequency =
      await this.limitsService.getDailyWithdrawalFrequency();

    if (frequency.mode === 'UNLIMITED') {
      return;
    }

    const limit = frequency.value;
    const { count, resetsAtIso } = await this.countAcceptedWithdrawalsToday(
      userId,
      manager,
      now,
    );

    if (count >= limit) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
        message: `Daily withdrawal limit reached (${limit} per day). Please try again after ${resetsAtIso}.`,
        limit,
        usedToday: count,
        resetsAt: resetsAtIso,
      });
    }
  }

  // ============================================================
  // REJECT BEFORE PAYOUT
  // ============================================================

  // ============================================================
  // USER LIMITS VIEW (supplementary frontend validation only)
  // ============================================================
  //
  // Backend remains the single source of truth: the frontend uses this only
  // to guide input before submission.
  async getUserLimits(userId: string): Promise<{
    deposit: { minUsdt: string; maxUsdt: string };
    withdraw: { minUsdt: string; maxUsdt: string };
    dailyWithdrawals: {
      mode: 'COUNT' | 'UNLIMITED';
      value: number | null;
      usedToday: number | null;
      resetsAt: string | null;
    };
  }> {
    const view = await this.limitsService.getUserLimitsView();

    if (view.dailyWithdrawals.mode === 'UNLIMITED') {
      return {
        deposit: view.deposit,
        withdraw: view.withdraw,
        dailyWithdrawals: {
          mode: 'UNLIMITED',
          value: null,
          usedToday: null,
          resetsAt: null,
        },
      };
    }

    const { count, resetsAtIso } = await this.countAcceptedWithdrawalsToday(
      userId,
      this.dataSource.manager,
    );

    return {
      deposit: view.deposit,
      withdraw: view.withdraw,
      dailyWithdrawals: {
        mode: 'COUNT',
        value: view.dailyWithdrawals.value,
        usedToday: count,
        resetsAt: resetsAtIso,
      },
    };
  }

  private async rejectBeforeBroadcast(
    withdrawalId: string,
    status: WithdrawalStatus.REJECTED | WithdrawalStatus.FAILED,
    reason: string,
    adminId?: string,
  ): Promise<Withdrawal> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);
      const withdrawal = await this.findWithdrawalForUpdate(repo, withdrawalId);

      if (withdrawal.status === status) {
        return withdrawal;
      }

      if (
        withdrawal.txHash ||
        withdrawal.payoutAttempted ||
        this.isPayoutStage(withdrawal.status)
      ) {
        throw new ConflictException(
          'Withdrawal has entered the payout lifecycle and cannot be automatically refunded',
        );
      }

      await this.releaseReserve(manager, withdrawal);

      // Restore the FIFO source attributions that this withdrawal reserved so
      // the capacity becomes eligible for a future withdrawal again.
      await this.walletSourceService.releaseReservation(
        this.getSourceAllocationLegs(withdrawal),
        manager,
      );

      withdrawal.status = status;
      withdrawal.rejectionReason = reason;
      withdrawal.adminApproved = false;

      withdrawal.metadata = {
        ...(withdrawal.metadata ?? {}),
        rejection: {
          reason,
          ...(adminId ? { rejectedBy: adminId } : {}),
          rejectedAt: new Date().toISOString(),
        },
        reserve: {
          released: true,
          releasedAt: new Date().toISOString(),
        },
      };

      return repo.save(withdrawal);
    });
  }

  // ============================================================
  // RESERVE TDX
  // ============================================================

  private async reserve(manager: EntityManager, withdrawal: Withdrawal): Promise<void> {
    const balance = await this.findBalanceForUpdate(manager, withdrawal.userId);
    const amount = this.decimal(withdrawal.tdxAmount);
    const available = this.decimal(balance.availableBalance);

    if (available.lt(amount)) {
      throw new ConflictException('Insufficient available balance');
    }

    balance.availableBalance = this.fixed(available.minus(amount));
    balance.lockedBalance = this.fixed(this.decimal(balance.lockedBalance).plus(amount));
    balance.withdrawalLocked = this.fixed(this.decimal(balance.withdrawalLocked).plus(amount));
    balance.lastUpdatedAt = new Date();

    await manager.getRepository(Balance).save(balance);

    await this.createLedger(
      manager,
      withdrawal,
      LedgerType.WITHDRAWAL_LOCK,
      amount,
      available,
      available.minus(amount),
      'WITHDRAWAL_LOCK',
    );
  }

  // ============================================================
  // RELEASE TDX RESERVE
  // ============================================================

  private async releaseReserve(manager: EntityManager, withdrawal: Withdrawal): Promise<void> {
    const ledgerRepo = manager.getRepository(LedgerEntry);

    const existingRelease = await ledgerRepo.findOne({
      where: {
        referenceId: withdrawal.id,
        referenceType: 'WITHDRAWAL_RELEASE',
        type: LedgerType.WITHDRAWAL_RELEASE,
      },
    });

    if (existingRelease) {
      return;
    }

    const balance = await this.findBalanceForUpdate(manager, withdrawal.userId);
    const amount = this.decimal(withdrawal.tdxAmount);
    const available = this.decimal(balance.availableBalance);
    const locked = this.decimal(balance.lockedBalance);
    const withdrawalLocked = this.decimal(balance.withdrawalLocked);

    if (locked.lt(amount) || withdrawalLocked.lt(amount)) {
      throw new ConflictException('Withdrawal reserve is inconsistent');
    }

    balance.availableBalance = this.fixed(available.plus(amount));
    balance.lockedBalance = this.fixed(locked.minus(amount));
    balance.withdrawalLocked = this.fixed(withdrawalLocked.minus(amount));
    balance.lastUpdatedAt = new Date();

    await manager.getRepository(Balance).save(balance);

    await this.createLedger(
      manager,
      withdrawal,
      LedgerType.WITHDRAWAL_RELEASE,
      amount,
      available,
      available.plus(amount),
      'WITHDRAWAL_RELEASE',
    );
  }

  // ============================================================
  // CONSUME TDX RESERVE
  // ============================================================

  private async consumeReserve(manager: EntityManager, withdrawal: Withdrawal): Promise<void> {
    const ledgerRepo = manager.getRepository(LedgerEntry);

    const existing = await ledgerRepo.findOne({
      where: {
        referenceId: withdrawal.id,
        referenceType: 'WITHDRAWAL',
        type: LedgerType.WITHDRAWAL,
      },
    });

    if (existing) {
      return;
    }

    const balance = await this.findBalanceForUpdate(manager, withdrawal.userId);
    const amount = this.decimal(withdrawal.tdxAmount);
    const available = this.decimal(balance.availableBalance);
    const locked = this.decimal(balance.lockedBalance);
    const withdrawalLocked = this.decimal(balance.withdrawalLocked);

    if (locked.lt(amount) || withdrawalLocked.lt(amount)) {
      throw new ConflictException('Withdrawal reserve is inconsistent');
    }

    balance.lockedBalance = this.fixed(locked.minus(amount));
    balance.withdrawalLocked = this.fixed(withdrawalLocked.minus(amount));
    balance.totalBalance = this.fixed(this.decimal(balance.totalBalance).minus(amount));
    balance.lastUpdatedAt = new Date();

    await manager.getRepository(Balance).save(balance);

    await this.createLedger(
      manager,
      withdrawal,
      LedgerType.WITHDRAWAL,
      amount,
      available,
      available,
      'WITHDRAWAL',
    );

    // reserved -> consumed for the FIFO source attributions. Idempotent and
    // saturating, so a retried completion can never double-consume a bucket.
    await this.walletSourceService.commitReservation(
      this.getSourceAllocationLegs(withdrawal),
      manager,
    );
  }

  // ============================================================
  // LEDGER
  // ============================================================

  private async createLedger(
    manager: EntityManager,
    withdrawal: Withdrawal,
    type: LedgerType,
    amount: Decimal,
    before: Decimal,
    after: Decimal,
    referenceType: string,
  ): Promise<void> {
    const repo = manager.getRepository(LedgerEntry);

    await repo.save(
      repo.create({
        userId: withdrawal.userId,
        type,
        amount: this.fixed(amount),
        balanceBefore: this.fixed(before),
        balanceAfter: this.fixed(after),
        referenceId: withdrawal.id,
        referenceType,
        description: `${type} ${this.fixed(amount)} TDX`,
        metadata: {
          withdrawalId: withdrawal.id,
          status: withdrawal.status,
          financialFlow: 'TDX_WITHDRAWAL',
        },
      }),
    );
  }

  // ============================================================
  // BALANCE LOCK
  // ============================================================

  private async findBalanceForUpdate(manager: EntityManager, userId: string): Promise<Balance> {
    const balance = await manager.getRepository(Balance).findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!balance) {
      throw new NotFoundException('Balance not found');
    }
    return balance;
  }

  // ============================================================
  // WITHDRAWAL ROW LOCK
  // ============================================================

  private async findWithdrawalForUpdate(
    repo: Repository<Withdrawal>,
    id: string,
  ): Promise<Withdrawal> {
    const withdrawal = await repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }
    return withdrawal;
  }

  // ============================================================
  // BASIC RISK CHECKS
  // ============================================================

  private runRiskChecks(
    walletAddress: string,
    chainId: number,
    tokenAddress: string,
  ): { passed: boolean; reason: string } {
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return { passed: false, reason: 'Withdrawal wallet address is invalid' };
    }

    if (!this.blockchainService.isSupportedPayoutConfiguration(chainId, tokenAddress)) {
      return { passed: false, reason: 'Withdrawal chain or token is unsupported' };
    }

    return { passed: true, reason: 'Basic withdrawal risk checks passed' };
  }

  // ============================================================
  // WALLET OWNERSHIP
  // ============================================================

  /**
   * A withdrawal may only be paid to a wallet that is LINKED (signature
   * verified) to the authenticated user.
   *
   * Two distinct failures are reported, so the client can tell them apart:
   *   - 404 WALLET_NOT_LINKED          → this address is not linked to ANY
   *     account yet; the user must link it first.
   *   - 403 WALLET_OWNED_BY_ANOTHER_ACCOUNT → the address IS linked, but to a
   *     different user (authorization failure, never a "not found").
   *
   * Runs BEFORE the transaction, so a rejected request never creates a
   * withdrawal row and never reserves balance / ledger entries.
   */
  private async validateWalletOwnership(
    userId: string,
    walletAddress: string,
    chainId: number,
  ): Promise<void> {
    this.validateEvmAddress(walletAddress, 'Invalid withdrawal wallet address');

    // Lookup is trim/case-insensitive: the row is stored checksummed, but a
    // pasted lowercase address must still resolve to the same wallet.
    const wallet = await this.walletsService.findByAddressAndChainId(
      walletAddress,
      chainId,
    );

    if (!wallet) {
      throw new NotFoundException({
        code: 'WALLET_NOT_LINKED',
        message:
          'This payout wallet is not linked to your account. Link this wallet to your TradeX account first, then request the withdrawal.',
      });
    }

    if (wallet.userId !== userId) {
      throw new ForbiddenException({
        code: 'WALLET_OWNED_BY_ANOTHER_ACCOUNT',
        message:
          'This payout wallet is linked to a different account. Use a wallet that is linked to your own account.',
      });
    }
  }

  // ============================================================
  // EVM ADDRESS VALIDATION
  // ============================================================

  private validateEvmAddress(address: string, message: string): void {
    if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
      throw new BadRequestException(message);
    }
  }

  // ============================================================
  // PAYOUT STAGE
  // ============================================================

  // ============================================================
  // SOURCE ALLOCATION HELPERS
  // ============================================================

  /** Reads the persisted FIFO legs from a withdrawal's metadata. */
  private getSourceAllocationLegs(
    withdrawal: Withdrawal,
  ): SourceAllocationLeg[] {
    const snapshot = (withdrawal.metadata ?? {})[
      'sourceAllocation'
    ] as SourceAllocationSnapshot | undefined;
    if (!snapshot || !Array.isArray(snapshot.legs)) return [];
    return snapshot.legs.filter(
      (leg) =>
        leg &&
        typeof leg.bucketId === 'string' &&
        typeof leg.amount === 'string',
    );
  }

  // ============================================================
  // IDEMPOTENCY HELPERS
  // ============================================================

  /**
   * A replay of the same (userId, clientRequestId) must describe the SAME
   * withdrawal intent. A different payload with the same key is rejected so a
   * key can never silently stand in for two different payouts.
   */
  private assertIdempotentReplayMatches(
    existing: Withdrawal,
    payload: {
      walletAddress: string;
      chainId: number;
      tokenAddress: string;
      tdxAmount: string;
    },
  ): void {
    const sameAddress =
      String(existing.walletAddress).toLowerCase() ===
      String(payload.walletAddress).toLowerCase();
    const sameToken =
      String(existing.tokenAddress).toLowerCase() ===
      String(payload.tokenAddress).toLowerCase();
    const sameChain = Number(existing.chainId) === Number(payload.chainId);
    const sameAmount = this.decimal(existing.tdxAmount).eq(
      this.decimal(payload.tdxAmount),
    );

    if (!sameAddress || !sameToken || !sameChain || !sameAmount) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH',
        message:
          'clientRequestId was already used with a different withdrawal payload',
      });
    }
  }

  /** True when the error is the (userId, clientRequestId) unique violation. */
  private isClientRequestUniqueViolation(error: unknown): boolean {
    const driverError = (error as { driverError?: { code?: string; constraint?: string } })
      ?.driverError;
    const anyError = error as { code?: string; constraint?: string };
    const code = driverError?.code ?? anyError?.code;
    const constraint = driverError?.constraint ?? anyError?.constraint;
    return (
      code === '23505' &&
      (constraint === 'IDX_withdrawals_user_clientRequestId_unique' ||
        constraint === undefined ||
        constraint === null)
    );
  }

  private isPayoutStage(status: WithdrawalStatus): boolean {
    return [
      WithdrawalStatus.APPROVED,
      WithdrawalStatus.QUEUED,
      WithdrawalStatus.PROCESSING,
      WithdrawalStatus.SENT,
      WithdrawalStatus.COMPLETED,
    ].includes(status);
  }

  private hasPayoutEvidence(withdrawal: Withdrawal): boolean {
    return this.hasRecordedTxHash(withdrawal.txHash) || withdrawal.payoutAttempted;
  }

  private hasRecordedTxHash(txHash: string | null | undefined): boolean {
    return typeof txHash === 'string' && txHash.trim().length > 0;
  }

  // ============================================================
  // REQUIRED CONFIRMATIONS
  // ============================================================

  private getRequiredConfirmations(): number {
    const configured = this.configService.get<string>('WITHDRAWAL_REQUIRED_CONFIRMATIONS');
    const parsed = Number(configured ?? '1');

    if (!Number.isInteger(parsed) || parsed < 1) {
      return 1;
    }
    return Math.min(parsed, 100);
  }

  // ============================================================
  // AMOUNT VALIDATION
  // ============================================================

  private validateAmount(amount: string): void {
    if (
      typeof amount !== 'string' ||
      !/^\d+(\.\d{1,18})?$/.test(amount) ||
      this.decimal(amount).lte(0)
    ) {
      throw new BadRequestException('Invalid TDX amount');
    }
  }

  // ============================================================
  // DECIMAL
  // ============================================================

  private decimal(value: string): Decimal {
    return new Decimal(value);
  }

  // ============================================================
  // FIXED DECIMAL
  // ============================================================

  private fixed(value: Decimal | string): string {
    return new Decimal(value).toFixed(18);
  }
}