// backend/src/modules/deposits/deposit.service.ts

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Deposit, DepositStatus } from './deposit.entity';
import { BalanceService } from '../balances/balance.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerType, LedgerEntry } from '../ledger/ledger.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { LimitsService } from '../limits/limits.service';
import { WageringService } from '../wagering/wagering.service';
import { WalletSourceService } from '../wagering/wallet-source.service';
import { FUND_SOURCE_TYPE } from '../wagering/wagering-source';

/** Audit actions for the below-minimum deposit recovery decisions. */
export const DEPOSIT_BELOW_MINIMUM_CREDITED_ACTION =
  'DEPOSIT_BELOW_MINIMUM_CREDITED';
export const DEPOSIT_BELOW_MINIMUM_REJECTED_ACTION =
  'DEPOSIT_BELOW_MINIMUM_REJECTED';

export type BelowMinimumReviewDecision = 'CREDIT' | 'REJECT';

/**
 * Outcome of an atomic deposit credit. `alreadyCredited` is a successful
 * no-op (idempotent replay), not an error.
 */
export interface DepositCreditResult {
  /** True only when this call performed the credit. */
  credited: boolean;
  /** True when the deposit was already COMPLETED before this call. */
  alreadyCredited: boolean;
  deposit: Deposit;
  /** Ledger entry that evidences the credit (null on idempotent replay). */
  ledgerEntryId: string | null;
  /** Whether a NEW wagering obligation was created. */
  obligationCreated: boolean;
}

interface CountVolumeMetric {
  count: number;
  volume: string;
}

interface DepositVaultSnapshot {
  balance: string | null;
  symbol: 'USDT';
  chainId: number | null;
  address: string | null;
  tokenAddress: string | null;
  fetchedAt: string;
  available: boolean;
  error?: string;
}

export interface DepositAdminStatistics {
  total: CountVolumeMetric;
  today: CountVolumeMetric;
  statuses: {
    pending: number;
    confirming: number;
    verified: number;
    completed: number;
    failed: number;
  };
  vault: DepositVaultSnapshot;
}

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    @InjectRepository(Deposit)
    private depositRepository: Repository<Deposit>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepository: Repository<AdminAuditLog>,
    private balanceService: BalanceService,
    private ledgerService: LedgerService,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
    private readonly limitsService: LimitsService,
    private readonly dataSource: DataSource,
    /**
     * Wagering enforcement is created in the SAME transaction as the
     * below-minimum recovery credit so a credited deposit can never be
     * withdrawn before its obligation exists (H1).
     */
    private readonly wageringService: WageringService,
    /**
     * FIFO source-attribution layer. A deposit credit records its bucket in
     * the SAME transaction as the balance credit + ledger entry, so the
     * credited funds are always classifiable when a withdrawal is attempted.
     */
    private readonly walletSourceService: WalletSourceService,
  ) {}

  // ============================================================
  // CREATE & UPDATE
  // ============================================================

  async createDeposit(depositData: Partial<Deposit>): Promise<Deposit> {
    const existing = await this.depositRepository.findOne({
      where: { transactionHash: depositData.transactionHash },
    });

    if (existing) {
      throw new ConflictException('Transaction already processed');
    }

    // ------------------------------------------------------------
    // BELOW-MINIMUM ON-CHAIN DEPOSIT (Architecture Plan v3, correction 2)
    // ------------------------------------------------------------
    // Detected deposits below the configured minimum are RECORDED with the
    // reviewable BELOW_MINIMUM status, never auto-credited, and remain
    // auditable/recoverable via the authorized admin CREDIT/REJECT actions.
    // Idempotency is unchanged: the unique transaction_hash remains the
    // exactly-once anchor (checked above and enforced by the DB unique
    // index), so a re-detection cannot double-record or double-credit.
    const { minUsdt } = await this.limitsService.getDepositLimits();
    const detectedUsdt = new Decimal(depositData.usdtAmount ?? '0');
    const isBelowMinimum =
      detectedUsdt.isFinite() && detectedUsdt.lt(new Decimal(minUsdt));

    const detectedAt = new Date();

    const deposit = this.depositRepository.create({
      ...depositData,
      status: isBelowMinimum
        ? DepositStatus.BELOW_MINIMUM
        : DepositStatus.PENDING,
      detectedAt,
      metadata: isBelowMinimum
        ? {
            ...(depositData.metadata ?? {}),
            belowMinimum: {
              detected: true,
              usdtAmount: detectedUsdt.toFixed(18),
              minimumAtDetection: minUsdt,
              tdxAmount: depositData.tdxAmount ?? null,
              // Captured conversion rate reused by any later admin credit.
              rateApplied: 100,
              detectedAt: detectedAt.toISOString(),
            },
          }
        : (depositData.metadata ?? {}),
    });

    return this.depositRepository.save(deposit);
  }

  // ============================================================
  // ADMIN: BELOW-MINIMUM DEPOSIT RECOVERY
  // ============================================================
  //
  // Authorized admins (AdminGuard + MFA/AAL2, mandatory reason) decide a
  // BELOW_MINIMUM deposit exactly once:
  // - CREDIT: credits the captured detection-time TDX amount through the
  //   existing balance/ledger source-of-truth path (BalanceService.creditTDX
  //   joining THIS transaction) — no second balance or ledger system.
  // - REJECT: marks the deposit reviewed/declined, no credit.
  //
  // The decision, the balance/ledger mutation (CREDIT only) and the
  // admin_audit_logs row are written in ONE transaction and are idempotent:
  // the deposit row is locked FOR UPDATE and must still be BELOW_MINIMUM, so
  // a repeated decision cannot double-credit or double-log.
  async reviewBelowMinimumDeposit(
    depositId: string,
    decision: BelowMinimumReviewDecision,
    reason: string,
    context: {
      adminId: string;
      ipAddress: string | null;
      userAgent: string | null;
    },
  ): Promise<Deposit> {
    const normalizedReason = (reason ?? '').trim();
    if (!normalizedReason) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'MISSING_REASON',
        message: 'A reason is required for every deposit review decision',
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const depositRepo = manager.getRepository(Deposit);
      const auditRepo = manager.getRepository(AdminAuditLog);

      const deposit = await depositRepo.findOne({
        where: { id: depositId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!deposit) {
        throw new NotFoundException('Deposit not found');
      }

      if (deposit.status !== DepositStatus.BELOW_MINIMUM) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'DEPOSIT_NOT_AWAITING_BELOW_MINIMUM_REVIEW',
          message: `Deposit is not awaiting below-minimum review. Current status: ${deposit.status}`,
          currentStatus: deposit.status,
        });
      }

      const capturedRate =
        (deposit.metadata?.belowMinimum as { rateApplied?: number })
          ?.rateApplied ?? 100;

      const before = {
        id: deposit.id,
        status: deposit.status,
        usdtAmount: deposit.usdtAmount,
        tdxAmount: deposit.tdxAmount,
        creditedAt: deposit.creditedAt,
        metadata: deposit.metadata ?? {},
      };

      if (decision === 'CREDIT') {
        // Captured detection-time conversion: the stored tdxAmount IS the
        // detection-time conversion, so the captured rate is preserved and
        // reused — never re-quoted at credit time.
        await this.balanceService.creditTDX(
          deposit.userId,
          deposit.tdxAmount,
          LedgerType.DEPOSIT,
          `Below-minimum deposit recovery: ${deposit.usdtAmount} USDT credited with detection-time rate`,
          deposit.id,
          {
            usdtAmount: deposit.usdtAmount,
            tdxAmount: deposit.tdxAmount,
            rateApplied: capturedRate,
            rateCapturedAtDetection: true,
            transactionHash: deposit.transactionHash,
            chainId: deposit.chainId,
            recoveredBy: context.adminId,
            reason: normalizedReason,
          },
          manager,
        );

        deposit.status = DepositStatus.COMPLETED;
        deposit.creditedAt = new Date();
        deposit.metadata = {
          ...(deposit.metadata ?? {}),
          belowMinimumReview: {
            decision: 'CREDIT',
            reason: normalizedReason,
            adminId: context.adminId,
            decidedAt: new Date().toISOString(),
            rateApplied: capturedRate,
          },
        };
      } else {
        deposit.status = DepositStatus.FAILED;
        deposit.metadata = {
          ...(deposit.metadata ?? {}),
          belowMinimumReview: {
            decision: 'REJECT',
            reason: normalizedReason,
            adminId: context.adminId,
            decidedAt: new Date().toISOString(),
          },
        };
      }

      const saved = await depositRepo.save(deposit);

      if (decision === 'CREDIT') {
        // H1 — close the withdrawal-enforcement gap: the wagering obligation
        // is created inside THIS transaction, using the same deposit row
        // (detection-time TDX amount + conversion rate) and the multiplier
        // snapshot resolved by WageringService. Either the credit, the ledger
        // entry and the obligation all commit, or nothing does — the deposit
        // stays BELOW_MINIMUM and the admin can safely retry the decision.
        // Idempotency is preserved by UNIQUE(wagering_obligations."depositId")
        // plus the pre-check inside createObligationForDeposit, so a later
        // reconciliation sweep can never add a second obligation.
        const creditedEntry = await manager.getRepository(LedgerEntry).findOne({
          where: {
            referenceId: saved.id,
            referenceType: 'deposit',
            type: LedgerType.DEPOSIT,
          },
          select: { id: true },
        });

        if (!creditedEntry) {
          // Refuse to commit a credit whose ledger anchor is missing — that
          // would be exactly the "credited funds with no recoverable
          // obligation" state this guard prevents.
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'BELOW_MINIMUM_CREDIT_LEDGER_MISSING',
            message:
              'Credit ledger entry missing for this deposit — no changes were committed',
          });
        }

        // Attribute the recovered deposit credit to its FIFO bucket in the
        // same transaction, so the admin-credited funds are classified too.
        await this.walletSourceService.recordCredit({
          manager,
          userId: saved.userId,
          sourceType: FUND_SOURCE_TYPE.DEPOSIT,
          sourceId: saved.id,
          ledgerEntryId: creditedEntry.id,
          amountTdx: new Decimal(String(saved.tdxAmount ?? '0')).toFixed(18),
          metadata: {
            depositId: saved.id,
            transactionHash: saved.transactionHash,
            recoveredByAdmin: context.adminId,
          },
        });

        // Returns false (no obligation) only when the platform policy says so:
        // wagering disabled, deposit predating activation, or zero TDX.
        await this.wageringService.createObligationForDeposit(
          saved,
          creditedEntry.id,
          manager,
        );
      }

      await auditRepo.save(
        auditRepo.create({
          adminId: context.adminId,
          action:
            decision === 'CREDIT'
              ? DEPOSIT_BELOW_MINIMUM_CREDITED_ACTION
              : DEPOSIT_BELOW_MINIMUM_REJECTED_ACTION,
          targetType: 'DEPOSIT',
          targetId: deposit.id,
          oldValue: before,
          newValue: {
            id: saved.id,
            status: saved.status,
            usdtAmount: saved.usdtAmount,
            tdxAmount: saved.tdxAmount,
            creditedAt: saved.creditedAt,
            metadata: saved.metadata ?? {},
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: normalizedReason,
            decision,
            transactionHash: deposit.transactionHash,
            chainId: deposit.chainId,
          },
        }),
      );

      return saved;
    });
  }

  async updateConfirmations(
    depositId: string,
    confirmations: number,
  ): Promise<Deposit> {
    const deposit = await this.getDepositById(depositId);

    deposit.confirmations = confirmations;

    if (
      confirmations >= deposit.requiredConfirmations &&
      (deposit.status === DepositStatus.PENDING ||
        deposit.status === DepositStatus.CONFIRMING)
    ) {
      deposit.status = DepositStatus.VERIFIED;
      deposit.confirmedAt = new Date();
    }

    return this.depositRepository.save(deposit);
  }

  /**
   * ATOMIC DEPOSIT CREDIT — the single authoritative credit path.
   *
   * Everything happens in ONE database transaction:
   *   1. lock the deposit row FOR UPDATE (serializes concurrent credits)
   *   2. re-verify status (idempotent: already COMPLETED -> no-op success)
   *   3. credit the user balance (with a pessimistic balance-row lock)
   *   4. insert the DEPOSIT ledger entry
   *   5. create the wagering obligation for sourceType='DEPOSIT'
   *   6. mark the deposit COMPLETED + creditedAt
   *
   * Any failure rolls back ALL of it. A retry can therefore never
   * double-credit, and a credited deposit can never exist without its ledger
   * entry and wagering obligation.
   */
  async creditDepositAtomic(
    depositId: string,
    manager?: EntityManager,
  ): Promise<DepositCreditResult> {
    if (manager) return this.runAtomicCredit(manager, depositId);

    return this.dataSource.transaction((em) =>
      this.runAtomicCredit(em, depositId),
    );
  }

  private async runAtomicCredit(
    em: EntityManager,
    depositId: string,
  ): Promise<DepositCreditResult> {
    const depositRepo = em.getRepository(Deposit);

    // 1. Row lock — the in-transaction serialization point.
    const deposit = await depositRepo
      .createQueryBuilder('d')
      .setLock('pessimistic_write')
      .where('d.id = :depositId', { depositId })
      .getOne();

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    // 2. Idempotency — an already-credited deposit is a successful no-op.
    if (deposit.status === DepositStatus.COMPLETED) {
      return {
        credited: false,
        alreadyCredited: true,
        deposit,
        ledgerEntryId: null,
        obligationCreated: false,
      };
    }

    if (deposit.status !== DepositStatus.VERIFIED) {
      throw new ConflictException(
        `Deposit is not ready to be credited (status: ${deposit.status})`,
      );
    }

    const amountTdx = new Decimal(String(deposit.tdxAmount ?? '0'));
    if (!amountTdx.isFinite() || amountTdx.lte(0)) {
      throw new ConflictException(
        `Invalid deposit TDX amount: ${deposit.tdxAmount}`,
      );
    }

    // 3 + 4. Balance credit and its ledger entry (exact decimal string).
    await this.balanceService.creditTDX(
      deposit.userId,
      amountTdx.toFixed(18),
      LedgerType.DEPOSIT,
      `Deposit of ${deposit.usdtAmount} USDT converted to ${amountTdx.toFixed(18)} TDX`,
      deposit.id,
      {
        usdtAmount: deposit.usdtAmount,
        tdxAmount: amountTdx.toFixed(18),
        chainId: deposit.chainId,
        token: 'USDT',
        txHash: deposit.transactionHash,
        transactionHash: deposit.transactionHash,
        depositOrderId: deposit.orderId ?? undefined,
        depositAddress: deposit.depositAddress ?? undefined,
      },
      em,
    );

    // 5. Resolve the credited ledger entry inside the SAME transaction.
    const ledgerEntry = await em.getRepository(LedgerEntry).findOne({
      where: {
        referenceId: deposit.id,
        referenceType: 'deposit',
        type: LedgerType.DEPOSIT,
      },
      select: { id: true },
    });

    if (!ledgerEntry) {
      // Refuse to commit a credit whose ledger anchor is missing.
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'DEPOSIT_CREDIT_LEDGER_MISSING',
        message:
          'Credit ledger entry missing for this deposit — no changes were committed',
      });
    }

    // 6. Mark the deposit credited — same transaction.
    deposit.status = DepositStatus.COMPLETED;
    deposit.creditedAt = new Date();
    deposit.metadata = {
      ...(deposit.metadata ?? {}),
      credited: {
        ledgerEntryId: ledgerEntry.id,
        tdxAmount: amountTdx.toFixed(18),
        creditedAt: deposit.creditedAt.toISOString(),
      },
    };
    const saved = await depositRepo.save(deposit);

    // 7. Attribute the credit to a FIFO source bucket — SAME transaction.
    // A deposit credit is wagerable, so its bucket starts wagering-locked
    // until the obligation below is satisfied.
    await this.walletSourceService.recordCredit({
      manager: em,
      userId: saved.userId,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: saved.id,
      ledgerEntryId: ledgerEntry.id,
      amountTdx: amountTdx.toFixed(18),
      metadata: {
        depositId: saved.id,
        transactionHash: saved.transactionHash,
        creditedAt: saved.creditedAt?.toISOString() ?? null,
      },
    });

    // 8. Wagering obligation — same transaction, idempotent by depositId.
    // Non-wagerable sources never reach this table; a deposit always does.
    let obligationCreated = false;
    try {
      obligationCreated = await this.wageringService.createObligationForDeposit(
        saved,
        ledgerEntry.id,
        em,
      );
    } catch (error) {
      // A missing obligation must not silently pass: roll the whole credit
      // back so reconciliation can retry cleanly instead of leaving credited
      // funds with no recoverable obligation.
      this.logger.error(
        `Wagering obligation failed for deposit ${deposit.id}: ${String(error)}`,
      );
      throw error;
    }

    return {
      credited: true,
      alreadyCredited: false,
      deposit: saved,
      ledgerEntryId: ledgerEntry.id,
      obligationCreated,
    };
  }

  /**
   * @deprecated Use {@link creditDepositAtomic}. Kept as a thin delegate so
   * every existing caller automatically gains atomicity; the previous
   * non-atomic implementation is intentionally gone.
   */
  async creditDeposit(depositId: string): Promise<Deposit> {
    const result = await this.creditDepositAtomic(depositId);
    return result.deposit;
  }

  // ============================================================
  // GETTERS
  // ============================================================

  async getDepositByTransactionHash(txHash: string): Promise<Deposit | null> {
    return this.depositRepository.findOne({
      where: { transactionHash: txHash },
    });
  }

  async getDepositById(id: string): Promise<Deposit> {
    const deposit = await this.depositRepository.findOne({
      where: { id },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    return deposit;
  }

  async getUserDeposits(userId: string): Promise<Deposit[]> {
    return this.depositRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lists deposits awaiting below-minimum review (Architecture Plan v3).
   * They are auditable and recoverable — never silently discarded.
   */
  async listBelowMinimumDeposits(
    limit: number,
    offset: number,
  ): Promise<{ items: Deposit[]; total: number; limit: number; offset: number }> {
    const [items, total] = await this.depositRepository.findAndCount({
      where: { status: DepositStatus.BELOW_MINIMUM },
      order: { createdAt: 'ASC' },
      skip: offset,
      take: Math.min(limit, 200),
    });

    return { items, total, limit, offset };
  }

  /**
   * GET USER DEPOSITS WITH PAGINATION
   * 
   * Returns paginated list of deposits for a specific user.
   * Used by the frontend transactions screen.
   */
  async getUserDepositsPaginated(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{
    data: Deposit[];
    total: number;
    limit: number;
    offset: number;
  }> {
    // ✅ Validate userId
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const [data, total] = await this.depositRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return {
      data,
      total,
      limit,
      offset,
    };
  }

  async getPendingDeposits(): Promise<Deposit[]> {
    return this.depositRepository.find({
      where: [
        { status: DepositStatus.PENDING },
        { status: DepositStatus.CONFIRMING },
        { status: DepositStatus.VERIFIED },
      ],
      order: { createdAt: 'ASC' },
    });
  }

  // ============================================================
  // ADMIN - ALL DEPOSITS WITH PAGINATION
  // ============================================================

  async getAllDeposits(params: {
    limit: number;
    offset: number;
    status?: DepositStatus;
    search?: string;
  }): Promise<{
    data: Deposit[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const where: FindOptionsWhere<Deposit> = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      const search = params.search.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      const isTxHash = /^0x[a-fA-F0-9]{64}$/i.test(search);
      const isNumeric = /^\d+$/.test(search);

      if (isUuid) {
        where.id = search;
      } else if (isTxHash) {
        where.transactionHash = search;
      } else if (isNumeric) {
        where.chainId = parseInt(search);
      } else {
        where.userId = Like(`%${search}%`);
      }
    }

    const [data, total] = await this.depositRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: params.offset,
      take: params.limit,
    });

    return {
      data,
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  // ============================================================
  // ADMIN - UPDATE STATUS
  // ============================================================

  async updateDepositStatus(
    depositId: string,
    status: DepositStatus,
    reason?: string,
  ): Promise<Deposit> {
    const deposit = await this.getDepositById(depositId);

    deposit.status = status;
    if (reason) {
      deposit.metadata = {
        ...deposit.metadata,
        statusChangeReason: reason,
        statusChangedAt: new Date().toISOString(),
      };
    }

    return this.depositRepository.save(deposit);
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getDepositStatistics(): Promise<DepositAdminStatistics> {
    const aggregate = await this.depositRepository
      .createQueryBuilder('deposit')
      .select(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus THEN 1 ELSE 0 END), 0)`,
        'total_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus THEN deposit.usdt_amount ELSE 0 END), 0)`,
        'total_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus AND deposit.credited_at >= CURRENT_DATE AND deposit.credited_at < CURRENT_DATE + INTERVAL '1 day' THEN 1 ELSE 0 END), 0)`,
        'today_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus AND deposit.credited_at >= CURRENT_DATE AND deposit.credited_at < CURRENT_DATE + INTERVAL '1 day' THEN deposit.usdt_amount ELSE 0 END), 0)`,
        'today_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :pendingStatus THEN 1 ELSE 0 END), 0)`,
        'pending_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :confirmingStatus THEN 1 ELSE 0 END), 0)`,
        'confirming_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :verifiedStatus THEN 1 ELSE 0 END), 0)`,
        'verified_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :failedStatus THEN 1 ELSE 0 END), 0)`,
        'failed_count',
      )
      .setParameters({
        completedStatus: DepositStatus.COMPLETED,
        pendingStatus: DepositStatus.PENDING,
        confirmingStatus: DepositStatus.CONFIRMING,
        verifiedStatus: DepositStatus.VERIFIED,
        failedStatus: DepositStatus.FAILED,
      })
      .getRawOne<{
        total_completed_count: string;
        total_completed_volume: string;
        today_completed_count: string;
        today_completed_volume: string;
        pending_count: string;
        confirming_count: string;
        verified_count: string;
        failed_count: string;
      }>();

    const vault = await this.getDepositVaultSnapshot();

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
        pending: this.toCount(aggregate?.pending_count),
        confirming: this.toCount(aggregate?.confirming_count),
        verified: this.toCount(aggregate?.verified_count),
        completed: this.toCount(aggregate?.total_completed_count),
        failed: this.toCount(aggregate?.failed_count),
      },
      vault,
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async getDepositVaultSnapshot(): Promise<DepositVaultSnapshot> {
    const configuredChainId = this.configService.get<string>('BSC_CHAIN_ID');
    const chainId = Number(configuredChainId ?? '56');
    const normalizedChainId =
      Number.isInteger(chainId) && chainId > 0 ? chainId : null;
    const configuredVaultAddress =
      this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() || null;
    const configuredTokenAddress =
      this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || null;
    const fetchedAt = new Date().toISOString();

    if (!normalizedChainId) {
      return {
        balance: null,
        symbol: 'USDT',
        chainId: null,
        address: configuredVaultAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }

    try {
      const [balance, address, tokenAddress] = await Promise.all([
        this.blockchainService.getVaultUsdtBalance(normalizedChainId),
        Promise.resolve(
          this.blockchainService.getVaultAddress(normalizedChainId),
        ),
        Promise.resolve(
          this.blockchainService.getUsdtAddress(normalizedChainId),
        ),
      ]);

      return {
        balance,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address,
        tokenAddress,
        fetchedAt,
        available: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch deposit vault balance: ${message}`);

      return {
        balance: null,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address: configuredVaultAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }
  }

  private toCount(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toAmount(value: string | number | null | undefined): string {
    const raw = value === null || value === undefined ? '0' : String(value);
    return /^[-+]?\d+(\.\d+)?$/.test(raw.trim()) ? raw : '0';
  }
}