import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import Decimal from 'decimal.js';
import { EntityManager, In, Repository } from 'typeorm';

import { User } from './user.entity';
import {
  ADMIN_USER_STATUSES,
  type AdminUserStatus,
} from './dto/admin-list-users-query.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminListReferralsQueryDto } from './dto/admin-list-referrals-query.dto';
import { ReferralPerformanceResponse } from './dto/referral-performance.dto';

import { Balance } from '../balances/balance.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { PULSE_SETTLEMENT_POLICY } from '../pulse-trade/constants/settlement-policy';
import { Trade } from '../pulse-trade/entities/trade.entity';

export type AdminUserMetricKey =
  | 'totalUsers'
  | 'activeUsers24h'
  | 'newUsersToday'
  | 'newUsers7d'
  | 'newUsers30d'
  | 'suspendedUsers'
  | 'inactiveUsers'
  | 'tradingUsers';

export interface AdminUserMetricAvailability {
  available: boolean;
  reason?: string;
}

export interface AdminUserMetricsResponse {
  totalUsers: number | null;
  activeUsers24h: number | null;
  newUsersToday: number | null;
  newUsers7d: number | null;
  newUsers30d: number | null;
  suspendedUsers: number | null;
  inactiveUsers: number | null;
  tradingUsers: number | null;
  availability: Record<AdminUserMetricKey, AdminUserMetricAvailability>;
  generatedAt: string;
}

type AdminUserListItem = {
  id: string;
  walletAddress: string;
  status: string;
  referralCode: string | null;
  referredBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  balance: {
    availableBalance: string;
    lockedBalance: string;
    totalBalance: string;
  } | null;
};

type AdminReferralListItem = {
  id: string;
  walletAddress: string;
  referralCode: string | null;
  referredBy: string | null;
  referrerWalletAddress: string | null;
  directReferralsCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type ReferralDashboardUser = {
  userId: string;
  walletAddress: string;
  level: number;
  percentage: string;
  earned: string;
  tradeVolume: string;
  active: boolean;
  joinedAt: string;
};

type ReferralDashboardLevel = {
  level: number;
  percentage: string;
  direct: boolean;
  users: ReferralDashboardUser[];
  totalEarned: string;
  totalUsers: number;
  activeUsers: number;
};

@Injectable()
export class UsersService {
  private static readonly REFERRAL_CODE_SEQUENCE_NAME =
    'users_referral_code_seq';
  private static readonly DEFAULT_FRONTEND_URL = 'https://tradex.app';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async findByAddress(walletAddress: string): Promise<User | null> {
    const normalizedAddress = this.normalizeAddress(walletAddress);

    if (!normalizedAddress) {
      return null;
    }

    return this.userRepository.findOne({
      where: {
        walletAddress: normalizedAddress,
      },
    });
  }

  async createWithReferral(
    walletAddress: string,
    referralCode?: string,
  ): Promise<User> {
    const normalizedAddress = this.normalizeAddress(walletAddress);

    if (!normalizedAddress) {
      throw new BadRequestException('Invalid wallet address');
    }

    return this.userRepository.manager.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);

      const existing = await userRepository.findOne({
        where: {
          walletAddress: normalizedAddress,
        },
      });

      if (existing) {
        return existing;
      }

      const normalizedReferralCode =
        this.normalizeSearch(referralCode)?.toUpperCase();
      let referrer: User | null = null;

      if (normalizedReferralCode) {
        referrer = await userRepository.findOne({
          where: {
            referralCode: normalizedReferralCode,
          },
        });

        if (!referrer) {
          throw new BadRequestException('Invalid referral code');
        }

        if (referrer.walletAddress === normalizedAddress) {
          throw new BadRequestException('Self-referral is not allowed');
        }
      }

      const ownReferralCode = await this.generateNextReferralCode(manager);

      const created = userRepository.create({
        walletAddress: normalizedAddress,
        status: 'active',
        referralCode: ownReferralCode,
        referredBy: referrer?.id ?? null,
      });

      return userRepository.save(created);
    });
  }

  async getAdminUsersList(query: AdminListUsersQueryDto): Promise<{
    items: AdminUserListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = this.normalizeLimit(query.limit);
    const offset = this.normalizeOffset(query.offset);
    const search = this.normalizeSearch(query.search);
    const status = this.normalizeUserStatus(query.status);

    const listQuery = this.userRepository.createQueryBuilder('user');

    if (status) {
      listQuery.andWhere('LOWER(user.status) = :status', { status });
    }

    if (search) {
      listQuery.andWhere(
        '(CAST(user.id AS text) ILIKE :search OR user.walletAddress ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const total = await listQuery.clone().getCount();

    const users = await listQuery
      .clone()
      .orderBy('user.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    if (users.length === 0) {
      return {
        items: [],
        total,
        limit,
        offset,
      };
    }

    const userIds = users.map((user) => user.id);
    const balanceRepository =
      this.userRepository.manager.getRepository(Balance);

    const balances = await balanceRepository.find({
      where: {
        userId: In(userIds),
      },
    });

    const balanceByUserId = new Map(
      balances.map((balance) => [balance.userId, balance]),
    );

    return {
      items: users.map((user) => {
        const balance = balanceByUserId.get(user.id);

        return {
          id: user.id,
          walletAddress: user.walletAddress,
          status: user.status,
          referralCode: user.referralCode,
          referredBy: user.referredBy,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          balance: balance
            ? {
                availableBalance: balance.availableBalance,
                lockedBalance: balance.lockedBalance,
                totalBalance: balance.totalBalance,
              }
            : null,
        };
      }),
      total,
      limit,
      offset,
    };
  }

  async getAdminReferralsList(query: AdminListReferralsQueryDto): Promise<{
    items: AdminReferralListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = this.normalizeLimit(query.limit);
    const offset = this.normalizeOffset(query.offset);
    const search = this.normalizeSearch(query.search);

    const listQuery = this.userRepository.createQueryBuilder('user');
    listQuery.where('user.referralCode IS NOT NULL');

    if (search) {
      listQuery.andWhere(
        [
          'CAST(user.id AS text) ILIKE :search',
          'user.walletAddress ILIKE :search',
          'user.referralCode ILIKE :search',
          'CAST(user.referredBy AS text) ILIKE :search',
        ].join(' OR '),
        { search: `%${search}%` },
      );
    }

    const total = await listQuery.clone().getCount();

    const users = await listQuery
      .clone()
      .orderBy('user.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    if (users.length === 0) {
      return {
        items: [],
        total,
        limit,
        offset,
      };
    }

    const userIds = users.map((user) => user.id);

    const directCountsRaw = await this.userRepository
      .createQueryBuilder('user')
      .select('user.referredBy', 'referredBy')
      .addSelect('COUNT(*)', 'count')
      .where('user.referredBy IN (:...userIds)', { userIds })
      .groupBy('user.referredBy')
      .getRawMany<{
        referredBy: string | null;
        count: string;
      }>();

    const directCountsByUserId = new Map<string, number>(
      directCountsRaw
        .filter((row) => Boolean(row.referredBy))
        .map((row) => [
          row.referredBy as string,
          Number.parseInt(row.count, 10) || 0,
        ]),
    );

    const referrerIds = Array.from(
      new Set(
        users
          .map((user) => user.referredBy)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const referrers = referrerIds.length
      ? await this.userRepository.find({
          where: {
            id: In(referrerIds),
          },
        })
      : [];

    const referrerWalletById = new Map(
      referrers.map((referrer) => [referrer.id, referrer.walletAddress]),
    );

    return {
      items: users.map((user) => ({
        id: user.id,
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referrerWalletAddress: user.referredBy
          ? (referrerWalletById.get(user.referredBy) ?? null)
          : null,
        directReferralsCount: directCountsByUserId.get(user.id) ?? 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      total,
      limit,
      offset,
    };
  }

  async getAdminUserMetrics(
    now: Date = new Date(),
  ): Promise<AdminUserMetricsResponse> {
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersToday,
      newUsers7d,
      newUsers30d,
      suspendedUsers,
      inactiveUsers,
      tradingUsersRaw,
    ] = await Promise.all([
      this.userRepository.createQueryBuilder('user').getCount(),
      this.userRepository
        .createQueryBuilder('user')
        .where('user.createdAt >= :startOfTodayUtc', { startOfTodayUtc })
        .getCount(),
      this.userRepository
        .createQueryBuilder('user')
        .where('user.createdAt >= :sevenDaysAgo', { sevenDaysAgo })
        .getCount(),
      this.userRepository
        .createQueryBuilder('user')
        .where('user.createdAt >= :thirtyDaysAgo', { thirtyDaysAgo })
        .getCount(),
      this.userRepository
        .createQueryBuilder('user')
        .where('LOWER(user.status) = :status', { status: 'blocked' })
        .getCount(),
      this.userRepository
        .createQueryBuilder('user')
        .where('LOWER(user.status) = :status', { status: 'inactive' })
        .getCount(),
      this.userRepository.manager
        .getRepository(Trade)
        .createQueryBuilder('trade')
        .select('COUNT(DISTINCT trade.userId)', 'count')
        .getRawOne<{ count: string | null }>(),
    ]);

    const activeUsers24hUnavailableReason =
      'No authoritative persisted 24h user activity signal is currently available.';

    return {
      totalUsers,
      activeUsers24h: null,
      newUsersToday,
      newUsers7d,
      newUsers30d,
      suspendedUsers,
      inactiveUsers,
      tradingUsers: this.parseRawCount(tradingUsersRaw?.count),
      availability: {
        totalUsers: { available: true },
        activeUsers24h: {
          available: false,
          reason: activeUsers24hUnavailableReason,
        },
        newUsersToday: { available: true },
        newUsers7d: { available: true },
        newUsers30d: { available: true },
        suspendedUsers: { available: true },
        inactiveUsers: { available: true },
        tradingUsers: { available: true },
      },
      generatedAt: now.toISOString(),
    };
  }

  async getMyReferralDashboard(userId: string): Promise<{
    referralCode: string;
    referralLink: string;
    stats: {
      totalNetwork: number;
      totalActive: number;
      totalEarned: string;
    };
    levels: ReferralDashboardLevel[];
  }> {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const referralCode = user.referralCode;

    if (!referralCode) {
      throw new BadRequestException(
        'Referral code is not initialized for user',
      );
    }

    const levels = await this.buildReferralLevels(user.id);

    const totalNetwork = levels.reduce(
      (sum, level) => sum + level.totalUsers,
      0,
    );
    const totalActive = levels.reduce(
      (sum, level) => sum + level.activeUsers,
      0,
    );
    const totalEarned = levels
      .reduce(
        (sum, level) => sum.plus(this.toDecimal(level.totalEarned)),
        new Decimal(0),
      )
      .toFixed(18);

    return {
      referralCode,
      referralLink: this.buildReferralLink(referralCode),
      stats: {
        totalNetwork,
        totalActive,
        totalEarned,
      },
      levels,
    };
  }

  async getMyReferralPerformance(
    userId: string,
  ): Promise<ReferralPerformanceResponse> {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const levels = await this.buildReferralLevels(user.id);
    const directLevel = levels.find((level) => level.level === 1);

    const directActive = directLevel?.activeUsers ?? 0;
    const teamActive = levels.reduce((sum, level) => sum + level.activeUsers, 0);

    const [monthlyEarnings, previousMonthEarnings] =
      await Promise.all([
        this.getReferralMonthEarnings(user.id, 0),
        this.getReferralMonthEarnings(user.id, 1),
      ]);

    return {
      directActive,
      teamActive,
      monthlyEarnings,
      previousMonthEarnings,
    };
  }

  private async buildReferralLevels(
    rootUserId: string,
  ): Promise<ReferralDashboardLevel[]> {
    const levels: ReferralDashboardLevel[] = [];
    let parentIds: string[] = [rootUserId];

    const percentages = [
      PULSE_SETTLEMENT_POLICY.referral.levels.L1,
      PULSE_SETTLEMENT_POLICY.referral.levels.L2,
      PULSE_SETTLEMENT_POLICY.referral.levels.L3,
      PULSE_SETTLEMENT_POLICY.referral.levels.L4,
      PULSE_SETTLEMENT_POLICY.referral.levels.L5,
      PULSE_SETTLEMENT_POLICY.referral.levels.L6,
    ];

    for (let level = 1; level <= 6; level += 1) {
      const percentage = percentages[level - 1] ?? '0';

      if (parentIds.length === 0) {
        levels.push({
          level,
          percentage,
          direct: level === 1,
          users: [],
          totalEarned: '0.000000000000000000',
          totalUsers: 0,
          activeUsers: 0,
        });
        continue;
      }

      const levelUsers = await this.userRepository.find({
        where: {
          referredBy: In(parentIds),
        },
        order: {
          createdAt: 'DESC',
        },
      });

      const referralUsers: ReferralDashboardUser[] = levelUsers.map((user) => ({
        userId: user.id,
        walletAddress: user.walletAddress,
        level,
        percentage,
        earned: '0.000000000000000000',
        tradeVolume: '0.000000000000000000',
        active: user.status === 'active',
        joinedAt: user.createdAt.toISOString(),
      }));

      const levelUserIds = referralUsers.map((user) => user.userId);

      if (levelUserIds.length > 0) {
        const ledgerRepository =
          this.userRepository.manager.getRepository(LedgerEntry);

        const earnedBySourceRaw = await ledgerRepository
          .createQueryBuilder('ledger')
          .select("ledger.metadata ->> 'sourceUserId'", 'sourceUserId')
          .addSelect(
            'COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)',
            'earned',
          )
          .where('ledger.userId = :rootUserId', { rootUserId })
          .andWhere('ledger.referenceType = :referenceType', {
            referenceType:
              PULSE_SETTLEMENT_POLICY.ledger.feeAllocationReferenceType,
          })
          .andWhere(
            "ledger.metadata ->> 'sourceUserId' IN (:...sourceUserIds)",
            {
              sourceUserIds: levelUserIds,
            },
          )
          .andWhere("ledger.metadata ->> 'referralLevel' = :referralLevel", {
            referralLevel: String(level),
          })
          .groupBy("ledger.metadata ->> 'sourceUserId'")
          .getRawMany<{
            sourceUserId: string | null;
            earned: string | null;
          }>();

        const earnedBySourceUserId = new Map<string, string>(
          earnedBySourceRaw
            .filter(
              (
                row,
              ): row is {
                sourceUserId: string;
                earned: string | null;
              } => Boolean(row.sourceUserId),
            )
            .map((row) => [row.sourceUserId, this.toFixed18(row.earned)]),
        );

        for (const referralUser of referralUsers) {
          referralUser.earned =
            earnedBySourceUserId.get(referralUser.userId) ??
            '0.000000000000000000';
        }
      }

      const totalEarned = referralUsers
        .reduce(
          (sum, user) => sum.plus(this.toDecimal(user.earned)),
          new Decimal(0),
        )
        .toFixed(18);

      levels.push({
        level,
        percentage,
        direct: level === 1,
        users: referralUsers,
        totalEarned,
        totalUsers: referralUsers.length,
        activeUsers: referralUsers.filter((user) => user.active).length,
      });

      parentIds = levelUsers.map((user) => user.id);
    }

    return levels;
  }

  private async getReferralMonthEarnings(
    rootUserId: string,
    monthsAgo: number,
  ): Promise<string> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    monthStart.setUTCMonth(monthStart.getUTCMonth() - monthsAgo);

    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    const ledgerRepository = this.userRepository.manager.getRepository(LedgerEntry);

    const raw = await ledgerRepository
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)', 'earned')
      .where('ledger.userId = :rootUserId', {
        rootUserId,
      })
      .andWhere('ledger.referenceType = :referenceType', {
        referenceType: PULSE_SETTLEMENT_POLICY.ledger.feeAllocationReferenceType,
      })
      .andWhere('ledger.createdAt >= :monthStart', {
        monthStart: monthStart.toISOString(),
      })
      .andWhere('ledger.createdAt < :monthEnd', {
        monthEnd: monthEnd.toISOString(),
      })
      .getRawOne<{ earned?: string | null }>();

    return this.toFixed18(raw?.earned);
  }

  private buildReferralLink(referralCode: string): string {
    const rawFrontendUrl =
      this.configService.get<string>('FRONTEND_URL')?.trim() ||
      UsersService.DEFAULT_FRONTEND_URL;

    try {
      const normalizedBaseUrl = new URL(rawFrontendUrl);
      const referralUrl = new URL('/register', normalizedBaseUrl);
      referralUrl.searchParams.set('ref', referralCode);
      return referralUrl.toString();
    } catch {
      const fallbackReferralUrl = new URL(
        '/register',
        UsersService.DEFAULT_FRONTEND_URL,
      );
      fallbackReferralUrl.searchParams.set('ref', referralCode);
      return fallbackReferralUrl.toString();
    }
  }

  private normalizeUserStatus(status: unknown): AdminUserStatus | undefined {
    const normalized = this.normalizeSearch(status);

    if (!normalized) {
      return undefined;
    }

    const lowered = normalized.toLowerCase();

    if (!ADMIN_USER_STATUSES.includes(lowered as AdminUserStatus)) {
      throw new BadRequestException('Unsupported status filter');
    }

    return lowered as AdminUserStatus;
  }

  private normalizeLimit(value: unknown): number {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return 20;
    }

    return Math.min(100, Math.max(1, Math.trunc(numeric)));
  }

  private normalizeOffset(value: unknown): number {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return 0;
    }

    return Math.max(0, Math.trunc(numeric));
  }

  private normalizeSearch(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizeAddress(address: string): string | undefined {
    try {
      return ethers.getAddress(address);
    } catch {
      return undefined;
    }
  }

  private async generateNextReferralCode(
    entityManager: EntityManager,
  ): Promise<string> {
    const rows: Array<{ nextValue: string | null }> = await entityManager.query(
      `
        SELECT nextval('"${UsersService.REFERRAL_CODE_SEQUENCE_NAME}"')::text AS "nextValue"
      `,
    );

    const nextValue = rows[0]?.nextValue?.trim();

    if (!nextValue || !/^\d+$/.test(nextValue)) {
      throw new BadRequestException('Failed to generate referral code');
    }

    return `TDX${nextValue}`;
  }

  private toFixed18(value: string | number | null | undefined): string {
    return this.toDecimal(value).toFixed(18);
  }

  private toDecimal(value: string | number | null | undefined): Decimal {
    try {
      return new Decimal(String(value ?? '0'));
    } catch {
      return new Decimal(0);
    }
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private parseRawCount(value: string | number | null | undefined): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);

      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
      }
    }

    return 0;
  }

  // ============================================================
  // ADMIN - USER DETAILS
  // ============================================================

  async getAdminUserDetails(userId: string): Promise<{
    user: {
      id: string;
      walletAddress: string;
      status: string;
      referralCode: string | null;
      referredBy: string | null;
      referrerWalletAddress: string | null;
      createdAt: string;
      updatedAt: string;
    };
    balance: {
      availableBalance: string;
      lockedBalance: string;
      totalBalance: string;
    } | null;
    stats: {
      deposits: string;
      withdrawals: string;
      totalTrades: number;
      totalTradeVolume: string;
      totalProfit: string;
      totalLoss: string;
    };
  }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { referrer: true } as const,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const balanceRepository = this.userRepository.manager.getRepository(Balance);
    const balance = await balanceRepository.findOne({
      where: { userId: user.id },
    });

    const ledgerRepository = this.userRepository.manager.getRepository(LedgerEntry);
    const tradeRepository = this.userRepository.manager.getRepository(Trade);

    // Get deposit total from ledger
    const depositTotal = await ledgerRepository
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)', 'total')
      .where('ledger.userId = :userId', { userId: user.id })
      .andWhere('ledger.type = :type', { type: LedgerType.DEPOSIT })
      .getRawOne<{ total: string }>();

    // Get withdrawal total from ledger
    const withdrawalTotal = await ledgerRepository
      .createQueryBuilder('ledger')
      .select('COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)', 'total')
      .where('ledger.userId = :userId', { userId: user.id })
      .andWhere('ledger.type = :type', { type: LedgerType.WITHDRAWAL })
      .getRawOne<{ total: string }>();

    // Get trade statistics
    const tradeStats = await tradeRepository
      .createQueryBuilder('trade')
      .select('COUNT(*)', 'totalTrades')
      .addSelect('COALESCE(SUM(CAST(trade.amount AS numeric)), 0)', 'totalVolume')
      .addSelect(
        `SUM(CASE WHEN trade.result = 'WIN' THEN CAST(trade.amount AS numeric) - CAST(trade.entryPrice AS numeric) ELSE 0 END)`,
        'totalProfit',
      )
      .addSelect(
        `SUM(CASE WHEN trade.result = 'LOSS' THEN CAST(trade.entryPrice AS numeric) - CAST(trade.amount AS numeric) ELSE 0 END)`,
        'totalLoss',
      )
      .where('trade.userId = :userId', { userId: user.id })
      .getRawOne<{
        totalTrades: string;
        totalVolume: string;
        totalProfit: string;
        totalLoss: string;
      }>();

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        status: user.status,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referrerWalletAddress: user.referrer?.walletAddress ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      balance: balance
        ? {
            availableBalance: balance.availableBalance,
            lockedBalance: balance.lockedBalance,
            totalBalance: balance.totalBalance,
          }
        : null,
      stats: {
        deposits: depositTotal?.total ?? '0',
        withdrawals: withdrawalTotal?.total ?? '0',
        totalTrades: parseInt(tradeStats?.totalTrades ?? '0', 10),
        totalTradeVolume: tradeStats?.totalVolume ?? '0',
        totalProfit: tradeStats?.totalProfit ?? '0',
        totalLoss: tradeStats?.totalLoss ?? '0',
      },
    };
  }

  // ============================================================
  // ADMIN - REFERRAL DETAILS
  // ============================================================

  async getAdminReferralDetails(referralUserId: string): Promise<{
    referral: {
      id: string;
      walletAddress: string;
      referralCode: string | null;
      referredBy: string | null;
      referrerWalletAddress: string | null;
      directReferralsCount: number;
      createdAt: string;
      updatedAt: string;
    };
    levels: Array<{
      level: number;
      percentage: string;
      users: number;
      earnings: string;
      activeUsers: number;
    }>;
    totalReferrals: number;
    totalEarnings: string;
    totalNetworkDeposits: string;
    totalNetworkWithdrawals: string;
    directReferrals: number;
    indirectReferrals: number;
    joinedAt: string;
  }> {
    const user = await this.userRepository.findOne({
      where: { id: referralUserId },
      relations: { referrer: true } as const,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const referralCode = user.referralCode;
    if (!referralCode) {
      throw new BadRequestException(
        'Referral code is not initialized for user',
      );
    }

    const levels = await this.buildReferralLevels(user.id);

    // Calculate totals from levels
    const totalReferrals = levels.reduce((sum, level) => sum + level.totalUsers, 0);
    const totalEarnings = levels
      .reduce((sum, level) => sum.plus(this.toDecimal(level.totalEarned)), new Decimal(0))
      .toFixed(18);
    const directReferrals = levels[0]?.totalUsers ?? 0;
    const indirectReferrals = totalReferrals - directReferrals;

    // Get referral network deposits and withdrawals from ledger
    const ledgerRepository = this.userRepository.manager.getRepository(LedgerEntry);

    // Get all user IDs in the referral network
    const allReferralUserIds = levels.flatMap((level) =>
      level.users.map((u) => u.userId),
    );

    let totalNetworkDeposits = '0';
    let totalNetworkWithdrawals = '0';

    if (allReferralUserIds.length > 0) {
      const networkDepositTotal = await ledgerRepository
        .createQueryBuilder('ledger')
        .select('COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)', 'total')
        .where('ledger.userId IN (:...userIds)', { userIds: allReferralUserIds })
        .andWhere('ledger.type = :type', { type: LedgerType.DEPOSIT })
        .getRawOne<{ total: string }>();

      const networkWithdrawalTotal = await ledgerRepository
        .createQueryBuilder('ledger')
        .select('COALESCE(SUM(CAST(ledger.amount AS numeric)), 0)', 'total')
        .where('ledger.userId IN (:...userIds)', { userIds: allReferralUserIds })
        .andWhere('ledger.type = :type', { type: LedgerType.WITHDRAWAL })
        .getRawOne<{ total: string }>();

      totalNetworkDeposits = networkDepositTotal?.total ?? '0';
      totalNetworkWithdrawals = networkWithdrawalTotal?.total ?? '0';
    }

    const userRepository = this.userRepository;
    const directReferralsCount = await userRepository.count({
      where: { referredBy: user.id },
    });

    return {
      referral: {
        id: user.id,
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referrerWalletAddress: user.referrer?.walletAddress ?? null,
        directReferralsCount,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      levels: levels.map((level) => ({
        level: level.level,
        percentage: level.percentage,
        users: level.totalUsers,
        earnings: level.totalEarned,
        activeUsers: level.activeUsers,
      })),
      totalReferrals,
      totalEarnings,
      totalNetworkDeposits,
      totalNetworkWithdrawals,
      directReferrals,
      indirectReferrals,
      joinedAt: user.createdAt.toISOString(),
    };
  }
}
