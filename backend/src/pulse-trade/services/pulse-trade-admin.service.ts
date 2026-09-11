import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { Decimal } from 'decimal.js';

import { User } from '../../users/user.entity';
import { Trade } from '../entities/trade.entity';
import { TradeResult, TradeStatus } from '../constants/enums';
import { AdminTradeQueryDto } from '../dtos/admin-trade-query.dto';
import { PULSE_SETTLEMENT_POLICY } from '../constants/settlement-policy';
import { ACTIVE_SETTLEMENT_STATUSES } from '../constants/trade-status.constants';

@Injectable()
export class PulseTradeAdminService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly dataSource: DataSource,
  ) {}

  // ============ HELPER METHODS ============

  private parseAmount(value: string): Decimal {
    return new Decimal(value);
  }

  private percentOf(amount: Decimal, percent: Decimal.Value): Decimal {
    return amount.times(percent).dividedBy(100);
  }

  private computePayout(stake: Decimal, result: TradeResult): Decimal {
    if (result === TradeResult.WIN) {
      const totalFee = this.percentOf(
        stake,
        PULSE_SETTLEMENT_POLICY.fee.totalPercent,
      );
      const netStake = stake.minus(totalFee);

      return netStake.mul(PULSE_SETTLEMENT_POLICY.payout.winMultiplier);
    }

    if (result === TradeResult.DRAW) {
      return stake.mul(PULSE_SETTLEMENT_POLICY.payout.drawMultiplier);
    }

    return new Decimal(PULSE_SETTLEMENT_POLICY.payout.lossPayout);
  }

  private normalizeSymbolOrThrow(symbol: string): string {
    const normalized = symbol.toUpperCase().trim();
    const validSymbols = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT'];
    if (!validSymbols.includes(normalized)) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }
    return normalized;
  }

  private normalizeDurationOrThrow(duration: string): string {
    const normalized = duration.toUpperCase().trim();
    const validDurations = ['30S', '1M', '3M', '5M', '10M'];
    if (!validDurations.includes(normalized)) {
      throw new Error(`Invalid duration: ${duration}`);
    }
    return normalized;
  }

  private pulseDurationCodeToSeconds(code: string): number {
    const map: Record<string, number> = {
      '30S': 30,
      '1M': 60,
      '3M': 180,
      '5M': 300,
      '10M': 600,
    };
    return map[code] || 60;
  }

  private durationCodeFromTrade(durationSeconds: number): string {
    const map: Record<number, string> = {
      30: '30S',
      60: '1M',
      180: '3M',
      300: '5M',
      600: '10M',
    };
    return map[durationSeconds] || '1M';
  }

  private remainingSeconds(now: Date, expiryAt: Date): number {
    return Math.max(0, Math.floor((expiryAt.getTime() - now.getTime()) / 1000));
  }

  private applyDateFilters(qb: any, from?: string, to?: string): void {
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        qb.andWhere('trade.createdAt >= :from', { from: fromDate });
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        // Set to end of day
        toDate.setHours(23, 59, 59, 999);
        qb.andWhere('trade.createdAt <= :to', { to: toDate });
      }
    }
  }

  // ============ WALLET LOOKUP ============

  private async getAdminWalletAddresses(
    trades: Trade[],
  ): Promise<Map<string, string | null>> {
    const userIds = [
      ...new Set(trades.map((trade) => trade.userId).filter(Boolean)),
    ];

    if (userIds.length === 0) {
      return new Map();
    }

    const users = await this.dataSource.getRepository(User).find({
      where: {
        id: In(userIds),
      },
      select: {
        id: true,
        walletAddress: true,
      },
    });

    return new Map(users.map((user) => [user.id, user.walletAddress ?? null]));
  }

  // ============ ADMIN TRADE VIEW ============

  private toAdminTradeView(trade: Trade, walletAddress: string | null) {
    const stake = this.parseAmount(trade.amount);
    const fee = this.percentOf(stake, PULSE_SETTLEMENT_POLICY.fee.totalPercent);
    const netStake = stake.minus(fee);

    let payout: Decimal | null = null;

    if (trade.status === TradeStatus.SETTLED && trade.result) {
      payout = this.computePayout(stake, trade.result);
    }

    const pnl = payout !== null ? payout.minus(stake) : null;

    return {
      id: trade.id,
      userId: trade.userId,
      walletAddress,
      symbol: trade.pair,
      direction: trade.direction,
      duration: this.durationCodeFromTrade(trade.duration),
      stake: stake.toFixed(18),
      fee: fee.toFixed(18),
      netStake: netStake.toFixed(18),
      entryPrice: this.parseAmount(trade.entryPrice).toFixed(18),
      expiryPrice: trade.exitPrice
        ? this.parseAmount(trade.exitPrice).toFixed(18)
        : null,
      entryAt: trade.createdAt.toISOString(),
      expiresAt: trade.expiryAt.toISOString(),
      settledAt: trade.settledAt ? trade.settledAt.toISOString() : null,
      status: trade.status,
      result: trade.result ?? null,
      payout: payout ? payout.toFixed(18) : null,
      pnl: pnl ? pnl.toFixed(18) : null,
      remainingSeconds: this.remainingSeconds(new Date(), trade.expiryAt),
      settlementRetryCount: Math.max(
        Number(trade.settlementRetryCount ?? 0),
        0,
      ),
      settlementFailureReason: trade.settlementFailureReason ?? null,
      lastSettlementAttemptAt: trade.lastSettlementAttemptAt
        ? trade.lastSettlementAttemptAt.toISOString()
        : null,
      nextSettlementRetryAt: trade.nextSettlementRetryAt
        ? trade.nextSettlementRetryAt.toISOString()
        : null,
      clientRequestId: trade.clientRequestId ?? null,
      createdAt: trade.createdAt.toISOString(),
      updatedAt: trade.updatedAt.toISOString(),
    };
  }

  // ============ ADMIN METHODS ============

  async getAdminTrades(query: AdminTradeQueryDto) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);

    const offset = Math.max(Number(query.offset ?? 0), 0);

    const qb = this.tradeRepo
      .createQueryBuilder('trade')
      .leftJoin(User, 'user', 'user.id = trade.userId')
      .addSelect('user.walletAddress', 'userWalletAddress')
      .where('1 = 1')
      .orderBy('trade.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;

      qb.andWhere(
        `(
          CAST(trade.id AS TEXT) ILIKE :search
          OR CAST(trade.userId AS TEXT) ILIKE :search
          OR CAST(trade.clientRequestId AS TEXT) ILIKE :search
          OR user.walletAddress ILIKE :search
        )`,
        { search },
      );
    }

    if (query.symbol) {
      const symbol = this.normalizeSymbolOrThrow(query.symbol);
      qb.andWhere('trade.pair = :pair', {
        pair: symbol,
      });
    }

    if (query.status && query.status !== 'ALL') {
      qb.andWhere('trade.status = :status', {
        status: query.status,
      });
    }

    if (query.direction && query.direction !== 'ALL') {
      qb.andWhere('trade.direction = :direction', {
        direction: query.direction,
      });
    }

    if (query.duration && query.duration !== 'ALL') {
      const durationCode = this.normalizeDurationOrThrow(query.duration);
      qb.andWhere('trade.duration = :durationSeconds', {
        durationSeconds: this.pulseDurationCodeToSeconds(durationCode),
      });
    }

    if (query.result && query.result !== 'ALL') {
      qb.andWhere('trade.result = :result', {
        result: query.result,
      });
    }

    this.applyDateFilters(qb, query.from, query.to);

    const [trades, total] = await qb.getManyAndCount();

    const rawRows = await this.getAdminWalletAddresses(trades);

    return {
      total,
      limit,
      offset,
      trades: trades.map((trade) =>
        this.toAdminTradeView(trade, rawRows.get(trade.userId) ?? null),
      ),
    };
  }

  async getAdminTradeById(tradeId: string) {
    const trade = await this.tradeRepo.findOne({
      where: {
        id: tradeId,
      },
    });

    if (!trade) {
      throw new NotFoundException('TRADE_NOT_FOUND');
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: {
        id: trade.userId,
      },
      select: {
        id: true,
        walletAddress: true,
      },
    });

    return {
      trade: this.toAdminTradeView(trade, user?.walletAddress ?? null),
    };
  }

  async getAdminTradeMetrics() {
    const trades = await this.tradeRepo.find();

    // totalStake is gross notional across all returned trades (open + terminal).
    let totalStake = new Decimal(0);
    // settledStake tracks only settled trades with a resolvable result and is used
    // for payout economics/profit math.
    let settledStake = new Decimal(0);
    let totalPayout = new Decimal(0);
    let todayVolume = new Decimal(0);

    let openTrades = 0;
    let settledTrades = 0;
    let delayedTrades = 0;
    let failedTrades = 0;

    const now = new Date();

    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    for (const trade of trades) {
      const stake = this.parseAmount(trade.amount);

      totalStake = totalStake.plus(stake);

      if (trade.createdAt >= startOfDay) {
        todayVolume = todayVolume.plus(stake);
      }

      if (ACTIVE_SETTLEMENT_STATUSES.includes(trade.status)) {
        openTrades += 1;
      }

      if (trade.status === TradeStatus.SETTLED) {
        settledTrades += 1;

        if (trade.result) {
          settledStake = settledStake.plus(stake);
          totalPayout = totalPayout.plus(
            this.computePayout(stake, trade.result),
          );
        }
      }

      if (trade.status === TradeStatus.SETTLEMENT_DELAYED) {
        delayedTrades += 1;
      }

      if (trade.status === TradeStatus.SETTLEMENT_FAILED) {
        failedTrades += 1;
      }
    }

    return {
      totalTrades: trades.length,
      openTrades,
      settledTrades,
      todaysTradeVolume: todayVolume.toFixed(18),
      settlementDelayed: delayedTrades,
      settlementFailed: failedTrades,
      totalStake: totalStake.toFixed(18),
      totalPayout: totalPayout.toFixed(18),
      // Admin totalProfit follows the same settled economics identity as portfolio:
      //   totalProfit = settledStake - totalPayout
      // (no additional fee subtraction to avoid double counting).
      totalProfit: settledStake.minus(totalPayout).toFixed(18),
    };
  }
}
