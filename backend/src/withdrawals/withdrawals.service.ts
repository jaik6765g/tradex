// backend/src/modules/withdrawals/withdrawals.service.ts

import {
  BadRequestException,
  ConflictException,
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

const BLOCKING_STATUSES = [
  WithdrawalStatus.REQUESTED,
  WithdrawalStatus.RISK_CHECKING,
  WithdrawalStatus.LIQUIDITY_CHECK,
  WithdrawalStatus.PENDING_ADMIN_APPROVAL,
];

const MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY = 'maxWithdrawalsPerUserPerDay';
const DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY = 3;

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

    const withdrawal = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Withdrawal);

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

      await this.assertWithinDailyWithdrawalLimit(userId, manager);

      const created = await repo.save(
        repo.create({
          userId,
          walletAddress,
          chainId,
          tokenAddress,
          tdxAmount: this.fixed(tdxAmount),
          usdtAmount: this.fixed(usdtAmount),
          fee: '0',
          status: WithdrawalStatus.REQUESTED,
          riskPassed: false,
          liquidityPassed: true,
          adminApproved: false,
          payoutAttempted: false,
          metadata: {
            withdrawalFlow: 'ADMIN_METAMASK_PAYOUT',
            liquidityCheck: 'NOT_REQUIRED_AT_REQUEST',
          },
        }),
      );

      await this.reserve(manager, created);
      created.status = WithdrawalStatus.RISK_CHECKING;
      return repo.save(created);
    });

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
  // REJECT BEFORE PAYOUT
  // ============================================================

  private async getDailyWithdrawalLimit(): Promise<number> {
    try {
      const setting = await this.adminSettingRepo.findOne({
        where: { key: MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY },
      });

      if (!setting) {
        return DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY;
      }

      const parsed = Number(setting.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
      }
      return Math.floor(parsed);
    } catch {
      return DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY;
    }
  }

  private async countCompletedWithdrawalsToday(
    userId: string,
    manager: EntityManager,
  ): Promise<number> {
    const repo = manager.getRepository(Withdrawal);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return repo
      .createQueryBuilder('w')
      .where('w.userId = :userId', { userId })
      .andWhere('w.status = :status', { status: WithdrawalStatus.COMPLETED })
      .andWhere('w.createdAt >= :startOfDay', { startOfDay })
      .getCount();
  }

  private async assertWithinDailyWithdrawalLimit(
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    const limit = await this.getDailyWithdrawalLimit();
    if (limit <= 0) return;

    const completedToday = await this.countCompletedWithdrawalsToday(userId, manager);
    if (completedToday >= limit) {
      throw new ConflictException(
        `Daily withdrawal limit reached (${limit} per day). Please try again tomorrow.`,
      );
    }
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

  private async validateWalletOwnership(
    userId: string,
    walletAddress: string,
    chainId: number,
  ): Promise<void> {
    this.validateEvmAddress(walletAddress, 'Invalid withdrawal wallet address');

    const wallet = await this.walletsService.findByAddressAndChainId(walletAddress, chainId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found or does not belong to user');
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