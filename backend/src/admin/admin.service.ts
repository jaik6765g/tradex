import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, In, Repository } from 'typeorm';

import { Balance } from '../balances/balance.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { User } from '../users/user.entity';

import {
  ADMIN_BONUS_MAX_AMOUNT,
  DistributeBonusDto,
  QueryAdminBonusHistoryDto,
} from './dto/admin-bonus.dto';
import { QueryAdminAuditLogsDto } from './dto/query-admin-audit-logs.dto';
import { QueryAdminSettingsDto } from './dto/query-admin-settings.dto';
import {
  AdminSettingValueType,
  UpdateAdminSettingDto,
} from './dto/update-admin-setting.dto';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminSetting } from './entities/admin-setting.entity';
import { WageringService } from '../wagering/wagering.service';
import { WalletSourceService } from '../wagering/wallet-source.service';
import { FUND_SOURCE_TYPE } from '../wagering/wagering-source';
import {
  BONUS_CATEGORY,
  isWageringDisabledForCategory,
  normalizeBonusCategory,
  validateBonusWageringMultiplier,
  type BonusCategory,
} from '../wagering/bonus-categories';
import {
  isDailyWithdrawalFrequencySettingKey,
  isNumericLimitSettingKey,
  LIMIT_MIN_EXCEEDS_MAX_CODE,
  LIMIT_PAIR_MAX_KEY,
  LIMIT_PAIR_MIN_KEY,
  LIMIT_SETTING_PAIRS,
  MISSING_REASON_CODE,
  normalizeDailyWithdrawalFrequencySettingValue,
} from '../limits/limits.service';

/** Ledger reference type written for every manual admin bonus distribution. */
export const ADMIN_BONUS_REFERENCE_TYPE = 'ADMIN_BONUS';

/**
 * Ledger reference type for admin-distributed REFERRAL_BONUS-category
 * bonuses, so ledger-evidence classification always lands them in the
 * non-wagerable REFERRAL_COMMISSION bucket.
 */
export const REFERRAL_BONUS_LEDGER_REFERENCE = 'REFERRAL_BONUS';

/** Audit log action recorded for every manual admin bonus distribution. */
export const ADMIN_BONUS_AUDIT_ACTION = 'ADMIN_BONUS_DISTRIBUTED';

export interface AdminAuditLogsResponse {
  items: AdminAuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSettingItem {
  id: string;
  key: string;
  value: string;
  valueType: AdminSettingValueType;
  parsedValue: string | number | boolean | Record<string, unknown> | unknown[];
  description: string | null;
  editable: boolean;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface AdminSettingsResponse {
  items: AdminSettingItem[];
  total: number;
  limit: number;
  offset: number;
}

interface UpdateSettingContext {
  adminId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminBonusContext {
  adminId: string;
  adminEmail?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminBonusDistributionResult {
  ledgerEntryId: string;
  userId: string;
  amount: string;
  description: string;
  availableBalanceBefore: string;
  availableBalanceAfter: string;
  totalBalanceBefore: string;
  totalBalanceAfter: string;
  adminId: string;
  idempotencyKey: string | null;
  replayed: boolean;
  distributedAt: string;
  bonusCategory: string | null;
  wageringRequired: boolean | null;
  wageringMultiplier: string | null;
  expiresAt: string | null;
  obligationCreated: boolean;
}

export interface AdminBonusHistoryItem {
  id: string;
  userId: string;
  walletAddress: string | null;
  amount: string;
  description: string;
  adminId: string | null;
  adminEmail: string | null;
  bonusCategory: string | null;
  wageringRequired: boolean | null;
  createdAt: string;
}

export interface AdminBonusHistoryResponse {
  items: AdminBonusHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepository: Repository<AdminAuditLog>,
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepository: Repository<AdminSetting>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntryRepository: Repository<LedgerEntry>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    /**
     * Wagering + FIFO attribution. Every manual bonus must (a) be attributed
     * to a BONUS bucket and (b) create exactly one BONUS wagering obligation,
     * in the SAME transaction as the credit.
     */
    private readonly wageringService: WageringService,
    private readonly walletSourceService: WalletSourceService,
  ) {}

  // ============================================================
  // ADMIN: MANUAL BONUS DISTRIBUTION
  // ============================================================

  /**
   * Credits a manual bonus to a user's balance with a mandatory
   * reason (description). Single atomic transaction:
   * idempotency check → user check → balance lock → credit →
   * ledger entry (referenceType='ADMIN_BONUS') → audit log.
   * Any failure rolls the entire transaction back.
   */
  async distributeBonus(
    dto: DistributeBonusDto,
    context: AdminBonusContext,
  ): Promise<AdminBonusDistributionResult> {
    const normalizedAmount = new Decimal(dto.amount).toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP,
    );

    if (normalizedAmount.isNegative() || normalizedAmount.isZero()) {
      throw new BadRequestException('Bonus amount must be greater than zero');
    }

    if (normalizedAmount.greaterThan(ADMIN_BONUS_MAX_AMOUNT)) {
      throw new BadRequestException(
        `Bonus amount must not exceed ${ADMIN_BONUS_MAX_AMOUNT} TDX`,
      );
    }

    const description = dto.description.trim();
    if (description.length < 3) {
      // Mirror of the DTO rule, enforced at the service boundary too, so the
      // mandatory-reason guarantee never depends on transport validation.
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'MISSING_BONUS_REASON',
        message: 'A reason (description) of at least 3 characters is required',
      });
    }
    const idempotencyKey = dto.idempotencyKey?.trim() || null;

    // ---- Bonus category + wagering policy (backend-enforced) ----
    const bonusCategory =
      normalizeBonusCategory(dto.bonusCategory) ?? BONUS_CATEGORY.MANUAL_BONUS;
    const wageringLockedByCategory =
      isWageringDisabledForCategory(bonusCategory);

    if (wageringLockedByCategory && dto.wageringRequired === true) {
      // REFERRAL_BONUS can never carry a wagering requirement — reject the
      // request instead of silently downgrading it (no silent policy bypass).
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'BONUS_WAGERING_NOT_ALLOWED',
        message: `Wagering cannot be required for ${bonusCategory}: referral bonuses are always non-wagerable`,
      });
    }

    const wageringRequired = wageringLockedByCategory
      ? false
      : (dto.wageringRequired ?? true);

    let multiplierDecimal: string | null = null;
    if (
      wageringRequired &&
      dto.wageringMultiplier !== undefined &&
      dto.wageringMultiplier !== null
    ) {
      const parsed = validateBonusWageringMultiplier(dto.wageringMultiplier);
      if (!parsed.ok) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_WAGERING_MULTIPLIER',
          message: parsed.reason,
        });
      }
      multiplierDecimal = parsed.multiplier.toFixed(18);
    }

    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      const parsedExpiry = new Date(dto.expiresAt);
      if (Number.isNaN(parsedExpiry.getTime())) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_BONUS_EXPIRY',
          message: 'expiresAt must be a valid ISO 8601 date-time',
        });
      }
      if (parsedExpiry.getTime() <= Date.now()) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'BONUS_EXPIRY_IN_PAST',
          message: 'expiresAt must be in the future',
        });
      }
      expiresAt = parsedExpiry;
    }

    if (wageringRequired) {
      // A wagering requirement demanded by the admin is hard policy: if
      // global wagering is disabled (or the activation cutoff has not
      // passed), the obligation could not be enforced. Reject instead of
      // crediting unenforced wagerable funds.
      const settings = await this.wageringService.getSettings();
      if (
        !settings.wageringEnabled ||
        !settings.activationTimestamp ||
        settings.activationTimestamp.getTime() > Date.now()
      ) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'WAGERING_REQUIRED_UNAVAILABLE',
          message:
            'Wagering is currently disabled — distribute with wageringRequired=false or enable wagering first',
        });
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      return await this.executeBonusDistribution(
        queryRunner,
        dto,
        context,
        normalizedAmount,
        description,
        idempotencyKey,
        { bonusCategory, wageringRequired, multiplierDecimal, expiresAt },
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async executeBonusDistribution(
    queryRunner: import('typeorm').QueryRunner,
    dto: DistributeBonusDto,
    context: AdminBonusContext,
    normalizedAmount: Decimal,
    description: string,
    idempotencyKey: string | null,
    policy: {
      bonusCategory: BonusCategory;
      wageringRequired: boolean;
      multiplierDecimal: string | null;
      expiresAt: Date | null;
    },
  ): Promise<AdminBonusDistributionResult> {
    // 1. Idempotency replay check — same key must never double-credit.
    if (idempotencyKey) {
      const existingEntry = await queryRunner.manager
        .createQueryBuilder(LedgerEntry, 'entry')
        .where('entry.referenceType IN (:...referenceTypes)', {
          referenceTypes: [
            ADMIN_BONUS_REFERENCE_TYPE,
            REFERRAL_BONUS_LEDGER_REFERENCE,
          ],
        })
        .andWhere("entry.metadata ->> 'idempotencyKey' = :idempotencyKey", {
          idempotencyKey,
        })
        .getOne();

      if (existingEntry) {
        await queryRunner.commitTransaction();
        return this.mapReplayedBonusResult(existingEntry, idempotencyKey);
      }
    }

    // 2. Target user must exist.
    const user = await queryRunner.manager.findOne(User, {
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`User not found for userId: ${dto.userId}`);
    }

    // 3. Lock the balance row for update (or create when missing).
    let balance = await queryRunner.manager
      .createQueryBuilder(Balance, 'balance')
      .setLock('pessimistic_write')
      .where('balance.userId = :userId', { userId: dto.userId })
      .getOne();

    if (!balance) {
      balance = queryRunner.manager.create(Balance, { userId: dto.userId });
      balance = await queryRunner.manager.save(balance);
    }

    const availableBefore = new Decimal(balance.availableBalance ?? '0');
    const totalBefore = new Decimal(balance.totalBalance ?? '0');
    const availableAfter = availableBefore.plus(normalizedAmount);
    const totalAfter = totalBefore.plus(normalizedAmount);

    // 4. Credit the balance.
    balance.availableBalance = availableAfter.toFixed(18);
    balance.totalBalance = totalAfter.toFixed(18);
    balance.lastUpdatedAt = new Date();
    await queryRunner.manager.save(balance);

    // 5. Ledger entry — the permanent bonus record with the reason.
    // REFERRAL_BONUS gets its own ledger reference type so ledger-evidence
    // classification (classifyLedgerCredit) always lands it in the
    // non-wagerable REFERRAL_COMMISSION bucket. All other categories keep
    // the ADMIN_BONUS anchor.
    const ledgerReferenceType =
      policy.bonusCategory === BONUS_CATEGORY.REFERRAL_BONUS
        ? REFERRAL_BONUS_LEDGER_REFERENCE
        : ADMIN_BONUS_REFERENCE_TYPE;

    const ledgerEntry = queryRunner.manager.create(LedgerEntry, {
      userId: dto.userId,
      type: LedgerType.ADMIN_ADJUSTMENT,
      amount: normalizedAmount.toFixed(18),
      balanceBefore: availableBefore.toFixed(18),
      balanceAfter: availableAfter.toFixed(18),
      referenceId: idempotencyKey ?? undefined,
      referenceType: ledgerReferenceType,
      description: `Admin bonus: ${description}`,
      metadata: {
        category: ADMIN_BONUS_REFERENCE_TYPE,
        bonusCategory: policy.bonusCategory,
        description,
        adminId: context.adminId,
        adminEmail: context.adminEmail ?? null,
        idempotencyKey,
        wageringRequired: policy.wageringRequired,
        wageringMultiplier: policy.multiplierDecimal,
        expiresAt: policy.expiresAt ? policy.expiresAt.toISOString() : null,
        availableBalanceBefore: availableBefore.toFixed(2),
        availableBalanceAfter: availableAfter.toFixed(2),
        totalBalanceBefore: totalBefore.toFixed(2),
        totalBalanceAfter: totalAfter.toFixed(2),
      },
    });
    const savedEntry = await queryRunner.manager.save(ledgerEntry);

    // 5b. FIFO source attribution + wagering obligation — SAME transaction.
    // Either the bonus balance, its ledger entry, its attribution bucket and
    // its single wagering obligation all commit, or nothing does.
    await this.walletSourceService.recordCredit({
      manager: queryRunner.manager,
      userId: dto.userId,
      sourceType:
        policy.bonusCategory === BONUS_CATEGORY.REFERRAL_BONUS
          ? FUND_SOURCE_TYPE.REFERRAL_COMMISSION
          : FUND_SOURCE_TYPE.BONUS,
      sourceId: savedEntry.id,
      ledgerEntryId: savedEntry.id,
      amountTdx: normalizedAmount.toFixed(18),
      metadata: {
        category: ADMIN_BONUS_REFERENCE_TYPE,
        bonusCategory: policy.bonusCategory,
        wageringRequired: policy.wageringRequired,
        idempotencyKey,
        adminId: context.adminId,
      },
    });

    // Wagering obligation ONLY when the admin required it. REFERRAL_BONUS can
    // never reach this branch (wageringRequired is forced false above), so a
    // referral bonus can never become wagerable.
    let obligationCreated = false;
    if (policy.wageringRequired) {
      obligationCreated = await this.wageringService.createObligationForBonus(
        {
          userId: dto.userId,
          bonusReference: savedEntry.id,
          ledgerEntryId: savedEntry.id,
          amountTdx: normalizedAmount.toFixed(18),
          creditedAt: savedEntry.createdAt,
          multiplierOverride: policy.multiplierDecimal,
          expiresAtOverride: policy.expiresAt,
          metadata: {
            bonusCategory: policy.bonusCategory,
            source: 'ADMIN_BONUS_DISTRIBUTION',
            idempotencyKey,
          },
        },
        queryRunner.manager,
      );

      if (!obligationCreated) {
        // The admin explicitly required wagering — a credited bonus without
        // its obligation must never commit. Throwing rolls back balance,
        // ledger entry and attribution bucket together.
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'WAGERING_OBLIGATION_NOT_CREATED',
          message:
            'Wagering obligation could not be created — bonus distribution rolled back',
        });
      }
    }

    // 6. Audit log — admin identity + reason, permanent trail.
    const auditLog = queryRunner.manager.create(AdminAuditLog, {
      adminId: context.adminId,
      action: ADMIN_BONUS_AUDIT_ACTION,
      targetType: 'user_balance',
      targetId: dto.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        userId: dto.userId,
        amount: normalizedAmount.toFixed(2),
        description,
        ledgerEntryId: savedEntry.id,
        idempotencyKey,
        bonusCategory: policy.bonusCategory,
        wageringRequired: policy.wageringRequired,
        wageringMultiplier: policy.multiplierDecimal,
        expiry: policy.expiresAt ? policy.expiresAt.toISOString() : null,
        obligationCreated,
        result: 'DISTRIBUTED',
      },
    });
    await queryRunner.manager.save(auditLog);

    await queryRunner.commitTransaction();

    return {
      ledgerEntryId: savedEntry.id,
      userId: dto.userId,
      amount: normalizedAmount.toFixed(2),
      description,
      availableBalanceBefore: availableBefore.toFixed(2),
      availableBalanceAfter: availableAfter.toFixed(2),
      totalBalanceBefore: totalBefore.toFixed(2),
      totalBalanceAfter: totalAfter.toFixed(2),
      adminId: context.adminId,
      idempotencyKey,
      replayed: false,
      distributedAt: savedEntry.createdAt.toISOString(),
      bonusCategory: policy.bonusCategory,
      wageringRequired: policy.wageringRequired,
      wageringMultiplier: policy.multiplierDecimal,
      expiresAt: policy.expiresAt ? policy.expiresAt.toISOString() : null,
      obligationCreated,
    };
  }

  private mapReplayedBonusResult(
    existingEntry: LedgerEntry,
    idempotencyKey: string,
  ): AdminBonusDistributionResult {
    const replayedMetadata = existingEntry.metadata ?? {};

    const pickString = (key: string, fallback: string): string =>
      typeof replayedMetadata[key] === 'string'
        ? replayedMetadata[key]
        : fallback;

    return {
      ledgerEntryId: existingEntry.id,
      userId: existingEntry.userId,
      amount: existingEntry.amount,
      description: pickString('description', existingEntry.description ?? ''),
      availableBalanceBefore: pickString(
        'availableBalanceBefore',
        existingEntry.balanceBefore,
      ),
      availableBalanceAfter: pickString(
        'availableBalanceAfter',
        existingEntry.balanceAfter,
      ),
      totalBalanceBefore: pickString(
        'totalBalanceBefore',
        existingEntry.balanceBefore,
      ),
      totalBalanceAfter: pickString(
        'totalBalanceAfter',
        existingEntry.balanceAfter,
      ),
      adminId: pickString('adminId', ''),
      idempotencyKey,
      replayed: true,
      distributedAt: existingEntry.createdAt.toISOString(),
      bonusCategory:
        typeof replayedMetadata['bonusCategory'] === 'string'
          ? replayedMetadata['bonusCategory']
          : null,
      wageringRequired:
        typeof replayedMetadata['wageringRequired'] === 'boolean'
          ? replayedMetadata['wageringRequired']
          : null,
      wageringMultiplier:
        typeof replayedMetadata['wageringMultiplier'] === 'string'
          ? replayedMetadata['wageringMultiplier']
          : null,
      expiresAt:
        typeof replayedMetadata['expiresAt'] === 'string'
          ? replayedMetadata['expiresAt']
          : null,
      obligationCreated: replayedMetadata['wageringRequired'] === true,
    };
  }

  /**
   * Lists every manual admin bonus (referenceType='ADMIN_BONUS') from
   * ledger_entries so the admin panel can show who received what, why
   * (description), and when. Optional userId filter for per-user history.
   */
  async getBonusHistory(
    queryDto: QueryAdminBonusHistoryDto,
  ): Promise<AdminBonusHistoryResponse> {
    const safeLimit =
      typeof queryDto.limit === 'number' && Number.isFinite(queryDto.limit)
        ? Math.max(1, Math.min(100, queryDto.limit))
        : 20;

    const safeOffset =
      typeof queryDto.offset === 'number' && Number.isFinite(queryDto.offset)
        ? Math.max(0, queryDto.offset)
        : 0;

    const query = this.ledgerEntryRepository
      .createQueryBuilder('entry')
      .where('entry.referenceType IN (:...referenceTypes)', {
        referenceTypes: [
          ADMIN_BONUS_REFERENCE_TYPE,
          REFERRAL_BONUS_LEDGER_REFERENCE,
        ],
      });

    const normalizedUserId = queryDto.userId?.trim();
    if (normalizedUserId) {
      query.andWhere('entry.userId = :userId', { userId: normalizedUserId });
    }

    const [entries, total] = await query
      .orderBy('entry.createdAt', 'DESC')
      .skip(safeOffset)
      .take(safeLimit)
      .getManyAndCount();

    // Resolve wallet addresses for the listed entries (batched).
    const walletAddressByUserId = new Map<string, string | null>();
    const uniqueUserIds = [...new Set(entries.map((entry) => entry.userId))];
    if (uniqueUserIds.length > 0) {
      const users = await this.dataSource
        .getRepository(User)
        .find({ where: { id: In(uniqueUserIds) } });
      for (const user of users) {
        walletAddressByUserId.set(user.id, user.walletAddress);
      }
    }

    const items = entries.map((entry) => {
      const metadata = entry.metadata ?? {};

      return {
        id: entry.id,
        userId: entry.userId,
        walletAddress: walletAddressByUserId.get(entry.userId) ?? null,
        amount: entry.amount,
        description:
          typeof metadata.description === 'string'
            ? metadata.description
            : (entry.description ?? ''),
        adminId: typeof metadata.adminId === 'string' ? metadata.adminId : null,
        adminEmail:
          typeof metadata.adminEmail === 'string' ? metadata.adminEmail : null,
        bonusCategory:
          typeof metadata.bonusCategory === 'string'
            ? metadata.bonusCategory
            : null,
        wageringRequired:
          typeof metadata.wageringRequired === 'boolean'
            ? metadata.wageringRequired
            : null,
        createdAt: entry.createdAt.toISOString(),
      };
    });

    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  async getAuditLogs(
    queryDto: QueryAdminAuditLogsDto,
  ): Promise<AdminAuditLogsResponse> {
    const safeLimit =
      typeof queryDto.limit === 'number' && Number.isFinite(queryDto.limit)
        ? Math.max(1, Math.min(100, queryDto.limit))
        : 20;

    const safeOffset =
      typeof queryDto.offset === 'number' && Number.isFinite(queryDto.offset)
        ? Math.max(0, queryDto.offset)
        : 0;

    const query = this.adminAuditLogRepository.createQueryBuilder('auditLog');

    const normalizedAction = queryDto.action?.trim();
    if (normalizedAction) {
      query.andWhere('auditLog.action = :action', {
        action: normalizedAction,
      });
    }

    const normalizedAdminId = queryDto.adminId?.trim();
    if (normalizedAdminId) {
      query.andWhere('auditLog.adminId = :adminId', {
        adminId: normalizedAdminId,
      });
    }

    const normalizedTargetType = queryDto.targetType?.trim();
    if (normalizedTargetType) {
      query.andWhere('auditLog.targetType = :targetType', {
        targetType: normalizedTargetType,
      });
    }

    const normalizedFrom = queryDto.from?.trim();
    if (normalizedFrom) {
      const fromDate = new Date(normalizedFrom);
      if (!Number.isNaN(fromDate.getTime())) {
        query.andWhere('auditLog.createdAt >= :fromDate', {
          fromDate,
        });
      }
    }

    const normalizedTo = queryDto.to?.trim();
    if (normalizedTo) {
      const toDate = new Date(normalizedTo);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        query.andWhere('auditLog.createdAt <= :toDate', {
          toDate,
        });
      }
    }

    const [items, total] = await query
      .orderBy('auditLog.createdAt', 'DESC')
      .skip(safeOffset)
      .take(safeLimit)
      .getManyAndCount();

    return {
      items,
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async getSettings(
    queryDto: QueryAdminSettingsDto,
  ): Promise<AdminSettingsResponse> {
    const safeLimit =
      typeof queryDto.limit === 'number' && Number.isFinite(queryDto.limit)
        ? Math.max(1, Math.min(100, queryDto.limit))
        : 20;

    const safeOffset =
      typeof queryDto.offset === 'number' && Number.isFinite(queryDto.offset)
        ? Math.max(0, queryDto.offset)
        : 0;

    const query =
      this.adminSettingRepository.createQueryBuilder('adminSetting');

    const normalizedSearch = queryDto.search?.trim();
    if (normalizedSearch) {
      query.andWhere(
        `(
          adminSetting.key ILIKE :search
          OR COALESCE(adminSetting.description, '') ILIKE :search
          OR adminSetting.value ILIKE :search
        )`,
        {
          search: `%${normalizedSearch}%`,
        },
      );
    }

    const [settings, total] = await query
      .orderBy('adminSetting.updatedAt', 'DESC')
      .skip(safeOffset)
      .take(safeLimit)
      .getManyAndCount();

    return {
      items: settings.map((setting) => this.toAdminSettingItem(setting)),
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  /**
   * Atomic admin setting update (Architecture Plan v3, correction 3).
   *
   * For the financial min/max limit pairs the whole read-lock-validate-write
   * sequence runs in ONE transaction:
   *   1. Lock the target row AND its min/max counterpart FOR UPDATE.
   *   2. Read the latest values under the lock (no stale/cached reads).
   *   3. Validate the min <= max invariant with exact Decimal.js math.
   *   4. Update the setting and write the admin_audit_logs row atomically.
   *
   * Concurrent admin updates serialize on the row locks and can never leave
   * the pair in an invariant-violating state. The mandatory `reason` is
   * enforced here (defence in depth on top of the DTO) and persisted in the
   * audit row metadata.
   */
  async updateSetting(
    key: string,
    dto: UpdateAdminSettingDto,
    context: UpdateSettingContext,
  ): Promise<AdminSettingItem> {
    const normalizedKey = key.trim();

    if (!normalizedKey) {
      throw new BadRequestException('Setting key is required');
    }

    const reason = (dto.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: MISSING_REASON_CODE,
        message: 'A reason is required for every admin setting change',
      });
    }

    // Validate + serialize the incoming value before opening the transaction
    // (pure computation, no DB access).
    const preflight = await this.adminSettingRepository.findOne({
      where: { key: normalizedKey },
    });

    if (!preflight) {
      throw new NotFoundException('Setting not found');
    }
    if (!preflight.editable) {
      throw new ConflictException('Setting is not editable');
    }

    const requestedValueType = dto.valueType ?? preflight.valueType;

    // ------------------------------------------------------------
    // WRITE-TIME KEY VALIDATION (pre-migration hardening)
    // ------------------------------------------------------------
    // The four monetary limit keys are money values and MUST be stored as
    // valueType 'number'. A non-number valueType would silently disable the
    // min/max invariant and fall back to built-in defaults, so it is
    // rejected outright.
    if (
      isNumericLimitSettingKey(normalizedKey) &&
      requestedValueType !== 'number'
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_SETTING_VALUE',
        message: `${normalizedKey} must be updated with valueType "number"`,
      });
    }

    let nextValueType: AdminSettingValueType = requestedValueType;
    let serializedValue: string;

    if (isDailyWithdrawalFrequencySettingKey(normalizedKey)) {
      // Strict structural validation + canonicalization. Legacy numeric input
      // is still accepted and converted to the canonical JSON form, so the
      // admin UI keeps working across the migration.
      nextValueType = 'json';
      serializedValue = normalizeDailyWithdrawalFrequencySettingValue(
        dto.value,
      );
    } else {
      const parsedIncomingValue = this.parseIncomingValue(
        dto.value,
        nextValueType,
      );
      serializedValue = this.serializeValue(parsedIncomingValue, nextValueType);
    }

    // Only the financial limit keys participate in the min <= max invariant.
    const counterpartKey = LIMIT_SETTING_PAIRS[normalizedKey] ?? null;
    const lockKeys = counterpartKey
      ? [normalizedKey, counterpartKey]
      : [normalizedKey];
    const updated = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AdminSetting);

      // 1. Lock every involved setting row FOR UPDATE (sorted order avoids
      //    deadlocks between concurrent pair updates).
      for (const lockKey of [...lockKeys].sort()) {
        await repo
          .createQueryBuilder('s')
          .setLock('pessimistic_write')
          .where('s.key = :key', { key: lockKey })
          .getMany();
      }

      // 2. Read the latest values under the lock.
      const locked = await repo.find({
        where: lockKeys.map((k) => ({ key: k })),
      });

      const setting = locked.find((s) => s.key === normalizedKey);
      if (!setting) {
        throw new NotFoundException('Setting not found');
      }
      if (!setting.editable) {
        throw new ConflictException('Setting is not editable');
      }

      // 3. Invariant validation on the EFFECTIVE post-update pair.
      if (counterpartKey && nextValueType === 'number') {
        const effectiveValue = (settingKey: string): Decimal => {
          const raw =
            settingKey === normalizedKey
              ? String(serializedValue)
              : (locked.find((s) => s.key === settingKey)?.value ?? '0');
          return new Decimal(raw);
        };

        const pairMin = effectiveValue(LIMIT_PAIR_MIN_KEY[normalizedKey]);
        const pairMax = effectiveValue(LIMIT_PAIR_MAX_KEY[normalizedKey]);

        if (
          !pairMin.isFinite() ||
          pairMin.lt(0) ||
          !pairMax.isFinite() ||
          pairMax.lt(0)
        ) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'INVALID_SETTING_VALUE',
            message: 'Limit values must be non-negative finite numbers',
          });
        }
        if (pairMin.gt(pairMax)) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: LIMIT_MIN_EXCEEDS_MAX_CODE,
            message: `Minimum limit (${pairMin.toString()}) must not exceed maximum limit (${pairMax.toString()})`,
            min: pairMin.toString(),
            max: pairMax.toString(),
          });
        }
      }

      const oldValue: Record<string, unknown> = {
        key: setting.key,
        value: setting.value,
        valueType: setting.valueType,
        description: setting.description,
        editable: setting.editable,
        updatedBy: setting.updatedBy,
      };

      setting.value = serializedValue;
      setting.valueType = nextValueType;
      setting.description = dto.description ?? setting.description;
      setting.editable = dto.editable ?? setting.editable;
      setting.updatedBy = context.adminId;

      const saved = await repo.save(setting);

      // 4. Audit row written in the SAME transaction — atomic with the change
      //    (a rejected validation writes neither the setting nor the audit).
      const auditRepo = manager.getRepository(AdminAuditLog);
      await auditRepo.save(
        auditRepo.create({
          adminId: context.adminId,
          action: 'ADMIN_SETTING_UPDATED',
          targetType: 'admin_setting',
          targetId: saved.id,
          oldValue,
          newValue: {
            key: saved.key,
            value: saved.value,
            valueType: saved.valueType,
            description: saved.description,
            editable: saved.editable,
            updatedBy: saved.updatedBy,
          },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            key: saved.key,
            valueType: saved.valueType,
            reason,
          },
        }),
      );

      return saved;
    });

    return this.toAdminSettingItem(updated);
  }

  private toAdminSettingItem(setting: AdminSetting): AdminSettingItem {
    return {
      id: setting.id,
      key: setting.key,
      value: setting.value,
      valueType: setting.valueType,
      parsedValue: this.parseStoredValue(setting.value, setting.valueType),
      description: setting.description,
      editable: setting.editable,
      updatedBy: setting.updatedBy,
      updatedAt: setting.updatedAt,
      createdAt: setting.createdAt,
    };
  }

  private parseIncomingValue(
    input: string,
    valueType: AdminSettingValueType,
  ): string | number | boolean | Record<string, unknown> | unknown[] {
    const normalizedInput = input.trim();

    if (!normalizedInput) {
      throw new BadRequestException('Setting value cannot be empty');
    }

    if (valueType === 'string') {
      return normalizedInput;
    }

    if (valueType === 'number') {
      const parsed = Number(normalizedInput);
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException('Invalid number value');
      }

      return parsed;
    }

    if (valueType === 'boolean') {
      const normalizedBoolean = normalizedInput.toLowerCase();
      if (normalizedBoolean === 'true' || normalizedBoolean === '1') {
        return true;
      }

      if (normalizedBoolean === 'false' || normalizedBoolean === '0') {
        return false;
      }

      throw new BadRequestException('Invalid boolean value');
    }

    try {
      const parsed = JSON.parse(normalizedInput) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown> | unknown[];
      }

      throw new BadRequestException('JSON value must be an object or array');
    } catch {
      throw new BadRequestException('Invalid JSON value');
    }
  }

  private serializeValue(
    value: string | number | boolean | Record<string, unknown> | unknown[],
    valueType: AdminSettingValueType,
  ): string {
    if (valueType === 'string') {
      if (typeof value !== 'string') {
        throw new BadRequestException('Invalid string value');
      }

      return value;
    }

    if (valueType === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException('Invalid number value');
      }

      return value.toString();
    }

    if (valueType === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new BadRequestException('Invalid boolean value');
      }

      return value ? 'true' : 'false';
    }

    if (typeof value !== 'object' || value === null) {
      throw new BadRequestException('JSON value must be an object or array');
    }

    return JSON.stringify(value);
  }

  private parseStoredValue(
    value: string,
    valueType: AdminSettingValueType,
  ): string | number | boolean | Record<string, unknown> | unknown[] {
    if (valueType === 'string') {
      return value;
    }

    if (valueType === 'number') {
      const parsedNumber = Number(value);
      return Number.isFinite(parsedNumber) ? parsedNumber : value;
    }

    if (valueType === 'boolean') {
      return value.trim().toLowerCase() === 'true';
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown> | unknown[];
      }
      return value;
    } catch {
      return value;
    }
  }
}
