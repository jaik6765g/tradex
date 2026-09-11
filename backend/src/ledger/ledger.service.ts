import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { LedgerEntry, LedgerType } from './ledger.entity';
import { CreateLedgerEntryDto } from './dto/ledger.dto';
import { QueryAdminLedgerDto } from './dto/query-admin-ledger.dto';
import type {
  AdminLedgerItemDto,
  AdminLedgerListResponseDto,
} from './dto/admin-ledger-response.dto';

@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private ledgerRepo: Repository<LedgerEntry>,
  ) {}

  // ============================================================
  // HELPERS
  // ============================================================

  private toDecimal(value: string | number): Decimal {
    return new Decimal(String(value));
  }

  private toNumber(value: Decimal): number {
    return value.toNumber();
  }

  private toFixed(value: Decimal): string {
    return value.toFixed(18);
  }

  // ============================================================
  // CREATE ENTRY
  // ============================================================

  async createEntry(entryData: CreateLedgerEntryDto): Promise<LedgerEntry> {
    const amount = this.toDecimal(entryData.amount);
    const before = this.toDecimal(entryData.balanceBefore);
    const after = this.toDecimal(entryData.balanceAfter);

    const entry = this.ledgerRepo.create({
      userId: entryData.userId,
      type: entryData.type,
      amount: this.toFixed(amount),
      balanceBefore: this.toFixed(before),
      balanceAfter: this.toFixed(after),
      referenceId: entryData.referenceId,
      referenceType: entryData.referenceType,
      description: entryData.description,
      metadata: entryData.metadata ?? {},
    });

    return this.ledgerRepo.save(entry);
  }

  // ============================================================
  // QUERIES
  // ============================================================

  async getUserLedgerEntries(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<LedgerEntry[]> {
    const query = this.ledgerRepo
      .createQueryBuilder('ledger')
      .where('ledger.userId = :userId', { userId })
      .orderBy('ledger.createdAt', 'DESC');

    if (limit) query.limit(limit);
    if (offset) query.offset(offset);
    return query.getMany();
  }

  async getLedgerEntriesByType(
    userId: string,
    type: LedgerType,
    limit?: number,
  ): Promise<LedgerEntry[]> {
    const query = this.ledgerRepo
      .createQueryBuilder('ledger')
      .where('ledger.userId = :userId', { userId })
      .andWhere('ledger.type = :type', { type })
      .orderBy('ledger.createdAt', 'DESC');

    if (limit) query.limit(limit);
    return query.getMany();
  }

  async getAdminLedgerEntries(
    queryDto: QueryAdminLedgerDto,
  ): Promise<AdminLedgerListResponseDto> {
    const safeLimit =
      typeof queryDto.limit === 'number' && Number.isFinite(queryDto.limit)
        ? Math.max(1, Math.min(100, queryDto.limit))
        : 20;

    const safeOffset =
      typeof queryDto.offset === 'number' && Number.isFinite(queryDto.offset)
        ? Math.max(0, queryDto.offset)
        : 0;

    const trimmedSearch = queryDto.search?.trim();

    const query = this.ledgerRepo
      .createQueryBuilder('ledger')
      .leftJoinAndSelect('ledger.user', 'user');

    if (queryDto.type) {
      query.andWhere('ledger.type = :type', {
        type: queryDto.type,
      });
    }

    if (trimmedSearch) {
      query.andWhere(
        `(
          CAST(ledger.id AS text) ILIKE :search
          OR CAST(ledger.userId AS text) ILIKE :search
          OR COALESCE(user.walletAddress, '') ILIKE :search
          OR COALESCE(ledger.referenceId, '') ILIKE :search
          OR COALESCE(ledger.referenceType, '') ILIKE :search
          OR COALESCE(ledger.description, '') ILIKE :search
        )`,
        {
          search: `%${trimmedSearch}%`,
        },
      );
    }

    const total = await query.clone().getCount();

    const entries = await query
      .clone()
      .orderBy('ledger.createdAt', 'DESC')
      .skip(safeOffset)
      .take(safeLimit)
      .getMany();

    const items: AdminLedgerItemDto[] = entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      walletAddress: entry.user?.walletAddress ?? null,
      type: entry.type,
      amount: entry.amount,
      balanceBefore: entry.balanceBefore,
      balanceAfter: entry.balanceAfter,
      referenceId: entry.referenceId ?? null,
      referenceType: entry.referenceType ?? null,
      description: entry.description ?? null,
      metadata: entry.metadata ?? {},
      createdAt: entry.createdAt,
    }));

    return {
      items,
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async getLedgerSummary(
    userId: string,
  ): Promise<{ type: LedgerType; total: string }[]> {
    const result = await this.ledgerRepo
      .createQueryBuilder('ledger')
      .select('ledger.type', 'type')
      .addSelect('SUM(ledger.amount)', 'total')
      .where('ledger.userId = :userId', { userId })
      .groupBy('ledger.type')
      .getRawMany();

    return result.map((row) => ({
      type: row.type as LedgerType,
      total: this.toFixed(this.toDecimal(row.total ?? '0')),
    }));
  }

  async getBalanceAtTime(
    userId: string,
    timestamp: Date,
  ): Promise<string | null> {
    const entry = await this.ledgerRepo
      .createQueryBuilder('ledger')
      .where('ledger.userId = :userId', { userId })
      .andWhere('ledger.createdAt <= :timestamp', { timestamp })
      .orderBy('ledger.createdAt', 'DESC')
      .getOne();

    return entry
      ? this.toFixed(this.toDecimal(entry.balanceAfter ?? '0'))
      : null;
  }

  async getBalance(userId: string): Promise<string> {
    const entries = await this.ledgerRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    if (entries.length === 0) return '0.000000000000000000';
    return this.toFixed(this.toDecimal(entries[0].balanceAfter ?? '0'));
  }

  // ============================================================
  // WITHDRAWAL OPERATIONS
  // ============================================================

  async reserveForWithdrawal(
    userId: string,
    amount: number,
    referenceId: string,
  ): Promise<void> {
    const existingLock = await this.ledgerRepo.findOne({
      where: {
        referenceId,
        referenceType: 'withdrawal',
        type: LedgerType.WITHDRAWAL_LOCK,
      },
    });

    if (existingLock) {
      return;
    }

    const currentBalance = this.toDecimal(await this.getBalance(userId));
    const reserveAmount = this.toDecimal(amount);
    const newBalance = currentBalance.minus(reserveAmount);

    if (newBalance.isNegative()) {
      throw new Error('Insufficient ledger balance');
    }

    await this.createEntry({
      userId,
      type: LedgerType.WITHDRAWAL_LOCK,
      amount: this.toNumber(reserveAmount),
      balanceBefore: this.toNumber(currentBalance),
      balanceAfter: this.toNumber(newBalance),
      referenceId,
      referenceType: 'withdrawal',
      description: `Reserved ${this.toFixed(reserveAmount)} TDX for withdrawal`,
      metadata: { status: 'RESERVED', amount: this.toFixed(reserveAmount) },
    });
  }

  async releaseWithdrawalReserve(
    userId: string,
    amount: number,
    referenceId: string,
  ): Promise<void> {
    const existingRelease = await this.ledgerRepo.findOne({
      where: {
        referenceId,
        referenceType: 'withdrawal',
        type: LedgerType.WITHDRAWAL_RELEASE,
      },
    });

    if (existingRelease) {
      return;
    }

    const currentBalance = this.toDecimal(await this.getBalance(userId));
    const releaseAmount = this.toDecimal(amount);
    const newBalance = currentBalance.plus(releaseAmount);

    await this.createEntry({
      userId,
      type: LedgerType.WITHDRAWAL_RELEASE,
      amount: this.toNumber(releaseAmount),
      balanceBefore: this.toNumber(currentBalance),
      balanceAfter: this.toNumber(newBalance),
      referenceId,
      referenceType: 'withdrawal',
      description: `Released ${this.toFixed(releaseAmount)} TDX from withdrawal reserve`,
      metadata: { status: 'RELEASED', amount: this.toFixed(releaseAmount) },
    });
  }

  // ✅ FIXED: Complete Withdrawal - Deducts TDX from balance
  async completeWithdrawal(
    userId: string,
    amount: number,
    referenceId: string,
  ): Promise<void> {
    const existingWithdrawal = await this.ledgerRepo.findOne({
      where: {
        referenceId,
        referenceType: 'withdrawal',
        type: LedgerType.WITHDRAWAL,
      },
    });

    if (existingWithdrawal) {
      return;
    }

    const currentBalance = this.toDecimal(await this.getBalance(userId));
    const withdrawalAmount = this.toDecimal(amount);
    const newBalance = currentBalance.minus(withdrawalAmount);

    if (newBalance.isNegative()) {
      throw new Error(
        `Insufficient balance: ${currentBalance.toFixed(4)} < ${withdrawalAmount.toFixed(4)}`,
      );
    }

    await this.createEntry({
      userId,
      type: LedgerType.WITHDRAWAL,
      amount: this.toNumber(withdrawalAmount),
      balanceBefore: this.toNumber(currentBalance),
      balanceAfter: this.toNumber(newBalance),
      referenceId,
      referenceType: 'withdrawal',
      description: `Withdrawal of ${this.toFixed(withdrawalAmount)} TDX`,
      metadata: {
        status: 'COMPLETED',
        amount: this.toFixed(withdrawalAmount),
        newBalance: this.toFixed(newBalance),
      },
    });

    console.log(
      `✅ TDX deducted: ${this.toFixed(withdrawalAmount)} → ${this.toFixed(newBalance)}`,
    );
  }
}
