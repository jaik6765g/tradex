// src/balances/balance.service.ts

import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { Balance } from './balance.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepo: Repository<Balance>,
    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // HELPERS
  // ============================================================

  private toDecimal(value: string | number | null | undefined): Decimal {
    return new Decimal(String(value ?? '0'));
  }

  private toFixed(value: Decimal): string {
    return value.toFixed(18);
  }

  private toNumber(value: string | number | null | undefined): number {
    return Number(this.toFixed(this.toDecimal(value)));
  }

  // ✅ Round to 2 decimal places
  private roundTo2Decimals(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // ============================================================
  // GET / CREATE BALANCE
  // ============================================================

  async getBalance(userId: string): Promise<Balance> {
    let balance = await this.balanceRepo.findOne({ where: { userId } });
    if (!balance) balance = await this.createBalance(userId);
    return balance;
  }

  async createBalance(userId: string, manager?: EntityManager): Promise<Balance> {
    const zero = '0.000000000000000000';
    const repo = manager ? manager.getRepository(Balance) : this.balanceRepo;
    return repo.save(
      repo.create({
        userId,
        availableBalance: zero,
        lockedBalance: zero,
        gameLocked: zero,
        tradingLocked: zero,
        withdrawalLocked: zero,
        totalBalance: zero,
      }),
    );
  }

  // ============================================================
  // CREDIT TDX
  // ============================================================

  async creditTDX(
    userId: string,
    amount: number | string,
    type: LedgerType,
    description: string,
    referenceId?: string,
    metadata?: Record<string, unknown>,
    /**
     * Optional caller-owned transaction. When provided, the balance + ledger
     * mutations join that transaction so callers (e.g. the admin
     * below-minimum deposit recovery flow) can make the decision, the
     * credit and the audit log atomic. When omitted, behavior is unchanged:
     * an own transaction is opened.
     */
    manager?: EntityManager,
  ): Promise<Balance> {
    const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new ConflictException(`Invalid credit amount: ${amount}`);
    }

    if (manager) {
      return this.applyCredit(
        manager,
        userId,
        amountNum,
        type,
        description,
        referenceId,
        metadata,
      );
    }

    return this.dataSource.transaction((txManager) =>
      this.applyCredit(
        txManager,
        userId,
        amountNum,
        type,
        description,
        referenceId,
        metadata,
      ),
    );
  }

  private async applyCredit(
    manager: EntityManager,
    userId: string,
    amountNum: number,
    type: LedgerType,
    description: string,
    referenceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<Balance> {
    const balanceRepo = manager.getRepository(Balance);
    const ledgerRepo = manager.getRepository(LedgerEntry);

    let balance = await balanceRepo.findOne({ where: { userId } });
    if (!balance) balance = await this.createBalance(userId, manager);

    if (referenceId) {
      const existingEntry = await ledgerRepo.findOne({
        where: {
          referenceId,
          type,
        },
      });

      if (existingEntry) {
        console.log(
          `⚠️ Skipping duplicate credit entry for reference ${referenceId} (${type})`,
        );

        return balance;
      }
    }

    const before = this.toDecimal(balance.availableBalance);
    const credit = this.toDecimal(amountNum);
    const after = before.plus(credit);
    const totalBefore = this.toDecimal(balance.totalBalance);
    const totalAfter = totalBefore.plus(credit);

    balance.availableBalance = this.toFixed(after);
    balance.totalBalance = this.toFixed(totalAfter);
    balance.lastUpdatedAt = new Date();
    await balanceRepo.save(balance);

    const entry = ledgerRepo.create({
      userId,
      type,
      amount: this.toFixed(credit),
      balanceBefore: this.toFixed(before),
      balanceAfter: this.toFixed(after),
      referenceId,
      referenceType: 'deposit',
      description,
      metadata: metadata ?? {},
    });
    await ledgerRepo.save(entry);

    console.log(`💳 TDX credit: ${before.toFixed(4)} → ${after.toFixed(4)}`);
    return balance;
  }

  // ============================================================
  // VIEW BALANCES - ✅ Rounded to 2 decimals
  // ============================================================

  async getAvailableBalance(userId: string): Promise<number> {
    const balance = await this.getBalance(userId);
    return this.roundTo2Decimals(this.toNumber(balance.availableBalance));
  }

  async getTotalBalance(userId: string): Promise<number> {
    const balance = await this.getBalance(userId);
    return this.roundTo2Decimals(this.toNumber(balance.totalBalance));
  }

  async getLockedBalance(userId: string): Promise<number> {
    const balance = await this.getBalance(userId);
    return this.roundTo2Decimals(this.toNumber(balance.lockedBalance));
  }

  // ============================================================
  // LOCK BALANCE
  // ============================================================

  async lockBalance(
    userId: string,
    amount: number,
    lockType: 'GAME' | 'TRADING' | 'WITHDRAWAL',
    description: string,
    referenceId?: string,
  ): Promise<Balance> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException('Invalid lock amount');
    }

    return this.dataSource.transaction(async (manager) => {
      const balanceRepo = manager.getRepository(Balance);
      const ledgerRepo = manager.getRepository(LedgerEntry);

      const balance = await balanceRepo.findOne({ where: { userId } });
      if (!balance) throw new NotFoundException('Balance not found');

      const available = this.toDecimal(balance.availableBalance);
      const lock = this.toDecimal(amount);
      if (available.lessThan(lock)) {
        throw new ConflictException(
          `Insufficient balance: ${available.toFixed(4)} < ${lock.toFixed(4)}`,
        );
      }

      const newAvailable = available.minus(lock);
      balance.availableBalance = this.toFixed(newAvailable);
      balance.lockedBalance = this.toFixed(
        this.toDecimal(balance.lockedBalance).plus(lock),
      );

      // Update specific lock
      const lockMap = {
        GAME: 'gameLocked',
        TRADING: 'tradingLocked',
        WITHDRAWAL: 'withdrawalLocked',
      };
      const key = lockMap[lockType];
      balance[key] = this.toFixed(this.toDecimal(balance[key]).plus(lock));

      balance.lastUpdatedAt = new Date();
      await balanceRepo.save(balance);

      const ledgerTypeByLockType: Record<
        'GAME' | 'TRADING' | 'WITHDRAWAL',
        LedgerType
      > = {
        GAME: LedgerType.GAME_ENTRY,
        TRADING: LedgerType.TRADE_ENTRY,
        WITHDRAWAL: LedgerType.WITHDRAWAL_LOCK,
      };

      const entry = ledgerRepo.create({
        userId,
        type: ledgerTypeByLockType[lockType],
        amount: this.toFixed(lock),
        balanceBefore: this.toFixed(available),
        balanceAfter: this.toFixed(newAvailable),
        referenceId,
        referenceType: 'lock',
        description,
        metadata: { lockType },
      });
      await ledgerRepo.save(entry);

      console.log(
        `🔒 TDX locked: ${lock.toFixed(4)} → ${newAvailable.toFixed(4)}`,
      );
      return balance;
    });
  }

  // ============================================================
  // RELEASE LOCK
  // ============================================================

  async releaseLock(
    userId: string,
    amount: number,
    lockType: 'GAME' | 'TRADING' | 'WITHDRAWAL',
    description: string,
    referenceId?: string,
  ): Promise<Balance> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException('Invalid release amount');
    }

    return this.dataSource.transaction(async (manager) => {
      const balanceRepo = manager.getRepository(Balance);
      const ledgerRepo = manager.getRepository(LedgerEntry);

      const balance = await balanceRepo.findOne({ where: { userId } });
      if (!balance) throw new NotFoundException('Balance not found');

      const release = this.toDecimal(amount);
      const lockMap = {
        GAME: 'gameLocked',
        TRADING: 'tradingLocked',
        WITHDRAWAL: 'withdrawalLocked',
      };
      const key = lockMap[lockType];
      const currentLock = this.toDecimal(balance[key]);

      if (currentLock.lessThan(release)) {
        throw new ConflictException(
          `Insufficient locked balance: ${currentLock.toFixed(4)} < ${release.toFixed(4)}`,
        );
      }

      const newLock = currentLock.minus(release);
      balance[key] = this.toFixed(newLock);
      balance.availableBalance = this.toFixed(
        this.toDecimal(balance.availableBalance).plus(release),
      );
      balance.lockedBalance = this.toFixed(
        this.toDecimal(balance.lockedBalance).minus(release),
      );
      balance.lastUpdatedAt = new Date();
      await balanceRepo.save(balance);

      const entry = ledgerRepo.create({
        userId,
        type: LedgerType.WITHDRAWAL_RELEASE,
        amount: this.toFixed(release),
        balanceBefore: this.toFixed(
          this.toDecimal(balance.availableBalance).minus(release),
        ),
        balanceAfter: this.toFixed(this.toDecimal(balance.availableBalance)),
        referenceId,
        referenceType: 'release',
        description,
        metadata: { lockType },
      });
      await ledgerRepo.save(entry);

      console.log(`🔓 TDX released: ${release.toFixed(4)}`);
      return balance;
    });
  }

  // ============================================================
  // DEDUCT BALANCE
  // ============================================================

  async deductBalance(
    userId: string,
    amount: number,
    type: LedgerType,
    description: string,
    referenceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<Balance> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException('Invalid deduct amount');
    }

    return this.dataSource.transaction(async (manager) => {
      const balanceRepo = manager.getRepository(Balance);
      const ledgerRepo = manager.getRepository(LedgerEntry);

      const balance = await balanceRepo.findOne({ where: { userId } });
      if (!balance) throw new NotFoundException('Balance not found');

      const available = this.toDecimal(balance.availableBalance);
      const deduct = this.toDecimal(amount);
      if (available.lessThan(deduct)) {
        throw new ConflictException(
          `Insufficient balance: ${available.toFixed(4)} < ${deduct.toFixed(4)}`,
        );
      }

      const newAvailable = available.minus(deduct);
      balance.availableBalance = this.toFixed(newAvailable);
      balance.totalBalance = this.toFixed(
        this.toDecimal(balance.totalBalance).minus(deduct),
      );
      balance.lastUpdatedAt = new Date();
      await balanceRepo.save(balance);

      const entry = ledgerRepo.create({
        userId,
        type,
        amount: this.toFixed(deduct),
        balanceBefore: this.toFixed(available),
        balanceAfter: this.toFixed(newAvailable),
        referenceId,
        referenceType: 'withdrawal',
        description,
        metadata: metadata ?? {},
      });
      await ledgerRepo.save(entry);

      console.log(
        `💳 TDX deducted: ${available.toFixed(4)} → ${newAvailable.toFixed(4)}`,
      );
      return balance;
    });
  }
}
