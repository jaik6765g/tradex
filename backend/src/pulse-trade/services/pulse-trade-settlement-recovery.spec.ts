/**
 * TRADEX PULSE TRADE — HIGH-3 admin settlement recovery tests.
 *
 * Scope: sirf recovery flow (state machine, race safety, idempotency, audit,
 * queue routing). Koi DB/Redis/blockchain I/O nahi. Recovery ka financial
 * effect existing authoritative settleTrade() se aata hai — uska proof
 * recovery → settleTrade full-loop test me hai.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

import { PULSE_SETTLEMENT_POLICY } from '../constants/settlement-policy';
import { TradeStatus } from '../constants/enums';
import {
  PULSE_SETTLEMENT_SETTLE_JOB,
  pulseSettlementTradeJobId,
} from '../workers/pulse-settlement.queue';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { Trade } from '../entities/trade.entity';
import { Balance } from '../../balances/balance.entity';
import { LedgerEntry } from '../../ledger/ledger.entity';
import { AdminSetting } from '../../admin/entities/admin-setting.entity';
import { PulseTradeService } from './pulse-trade.service';

const Z = '0.000000000000000000';

type TradeRow = {
  id: string;
  userId: string;
  pair: string;
  direction: string;
  duration: number;
  amount: string;
  entryPrice: string;
  exitPrice: string | null;
  result: string | null;
  status: string;
  createdAt: Date;
  expiryAt: Date;
  settledAt: Date | null;
  settlementRetryCount: number;
  settlementFailureReason: string | null;
  lastSettlementAttemptAt: Date | null;
  nextSettlementRetryAt: Date | null;
  updatedAt: Date;
};

const NOW = new Date('2026-09-01T00:00:00.000Z');

function makeFailedTrade(o: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 'trade-failed-1',
    userId: 'user-1',
    pair: 'BTC/USDT',
    direction: 'LONG',
    duration: 60,
    amount: '100.000000000000000000',
    entryPrice: '50000.000000000000000000',
    exitPrice: null,
    result: null,
    status: TradeStatus.SETTLEMENT_FAILED,
    createdAt: new Date(NOW.getTime() - 120000),
    expiryAt: new Date(NOW.getTime() - 60000),
    settledAt: null,
    settlementRetryCount: 5,
    settlementFailureReason: 'settlement retries exhausted',
    lastSettlementAttemptAt: new Date(NOW.getTime() - 30000),
    nextSettlementRetryAt: null,
    updatedAt: NOW,
    ...o,
  };
}

const recoveryContext = {
  ipAddress: '10.0.0.1',
  userAgent: 'jest-agent',
};

function makeHarness(
  opts: {
    queueFails?: boolean;
    auditFails?: boolean;
    noQueue?: boolean;
    settlementPrice?: string;
  } = {},
) {
  const trades: TradeRow[] = [];
  const ledgers: Array<Record<string, any>> = [];
  const audits: Array<Record<string, any>> = [];
  const balances = new Map<string, Record<string, string>>();
  const queueAdds: Array<Record<string, any>> = [];
  const repoTargets: string[] = [];
  let updateCount = 0;
  let stealSettle = false; // race: worker ne recovery UPDATE se pehle settle kar diya
  let blockReset = false; // race: UPDATE affected=0, state unchanged

  const poolSetting = {
    key: 'PULSE_LIQUIDITY_POOL_BALANCE',
    value: '1000000.000000000000000000',
  };

  const seedBalance = (
    userId: string,
    available: string,
    locked: string,
  ): void => {
    balances.set(userId, {
      userId,
      availableBalance: available,
      lockedBalance: locked,
      tradingLocked: locked,
      gameLocked: Z,
      withdrawalLocked: Z,
      totalBalance: available,
    });
  };

  const unwrapStatus = (raw: unknown): string[] | null => {
    if (raw === undefined) return null;
    const unwrapped =
      raw && typeof raw === 'object'
        ? ((raw as { value?: unknown }).value ??
          (raw as { values?: unknown }).values)
        : raw;
    return (Array.isArray(unwrapped) ? unwrapped : [unwrapped]).map(String);
  };

  const tradeRepo = {
    findOne: async (q?: { where?: { id?: string } }) =>
      trades.find((t) => t.id === q?.where?.id) ?? null,
    update: async (criteria: any, patch: Record<string, unknown>) => {
      updateCount += 1;
      const row = trades.find((t) => t.id === criteria?.id);
      if (!row) return { affected: 0 };
      const required = unwrapStatus(criteria?.status);
      if (required && !required.includes(row.status)) return { affected: 0 };
      if (stealSettle) {
        row.status = TradeStatus.SETTLED;
        return { affected: 0 };
      }
      if (blockReset) return { affected: 0 };
      Object.assign(row, patch);
      return { affected: 1 };
    },
    create: (x: Partial<TradeRow>) => ({ ...x }),
    save: async (e: TradeRow) => {
      const i = trades.findIndex((t) => t.id === e.id);
      if (i >= 0) Object.assign(trades[i], e);
      else trades.push(e);
      return e;
    },
  };

  const auditRepo = {
    create: (x: Record<string, unknown>) => ({
      id: `audit-${audits.length + 1}`,
      ...x,
    }),
    save: async (e: Record<string, unknown>) => {
      if (opts.auditFails) throw new Error('AUDIT_WRITE_FAILURE');
      audits.push(e);
      return e;
    },
  };

  const settlementQueue = opts.noQueue
    ? undefined
    : {
        add: async (name: string, data: unknown, o: { jobId?: string }) => {
          if (opts.queueFails) throw new Error('REDIS_DOWN');
          queueAdds.push({ name, data, opts: o });
          return { id: o?.jobId ?? null };
        },
      };

  const priceService = {
    getAuthoritativePriceIndex: async () => ({
      indexPrice: opts.settlementPrice ?? '51000.000000000000000000',
      calculatedAt: new Date(),
    }),
  };

  const balanceRepo = {
    findOne: async (q?: { where?: { userId?: string } }) =>
      balances.get(q?.where?.userId ?? '') ?? null,
  };

  const dataSource = {
    getRepository: (target: unknown) => {
      repoTargets.push(String((target as { name?: string })?.name ?? target));
      if (target === AdminAuditLog) return auditRepo;
      if (target === Trade) return tradeRepo;
      return null;
    },
    transaction: async <T>(cb: (manager: any) => Promise<T>): Promise<T> => {
      // Mini rollback model: settlement tx fail → in-tx writes undo.
      const tradesLen = trades.length;
      const ledgersLen = ledgers.length;
      const balancesSnapshot = new Map(
        [...balances].map(([k, v]) => [k, { ...v }]),
      );
      const poolSnapshot = poolSetting.value;
      const manager = {
        getRepository: (target: unknown) => {
          if (target === Trade) {
            return {
              findOne: async (q?: { where?: { id?: string } }) =>
                trades.find((t) => t.id === q?.where?.id) ?? null,
              save: async (e: TradeRow) => {
                const i = trades.findIndex((t) => t.id === e.id);
                if (i >= 0) Object.assign(trades[i], e);
                else trades.push(e);
                return e;
              },
            };
          }
          if (target === Balance) {
            return {
              findOne: async (q?: { where?: { userId?: string } }) =>
                balances.get(q?.where?.userId ?? '') ?? null,
              create: (x: Record<string, unknown>) => ({ ...x }),
              save: async (e: { userId: string }) => {
                balances.set(e.userId, e as Record<string, string>);
                return e;
              },
            };
          }
          if (target === LedgerEntry) {
            return {
              create: (x: Record<string, unknown>) => ({
                id: `l-${ledgers.length + 1}`,
                ...x,
              }),
              save: async (e: Record<string, any>) => {
                if (
                  e.referenceType ===
                    PULSE_SETTLEMENT_POLICY.ledger.settlementReferenceType &&
                  ledgers.some(
                    (l) =>
                      l.referenceId === e.referenceId &&
                      l.referenceType === e.referenceType,
                  )
                ) {
                  throw new Error(
                    'duplicate key value violates unique constraint "IDX_ledger_trade_settlement_reference_unique"',
                  );
                }
                ledgers.push(e);
                return e;
              },
            };
          }
          if (target === AdminSetting) {
            return {
              findOne: async () => ({ ...poolSetting }),
              create: (x: Record<string, unknown>) => ({ ...x }),
              save: async (e: { value: string }) => {
                poolSetting.value = e.value;
                return e;
              },
            };
          }
          throw new Error('Unexpected repository target');
        },
      };
      try {
        return await cb(manager);
      } catch (error) {
        trades.length = tradesLen;
        ledgers.length = ledgersLen;
        balances.clear();
        for (const [k, v] of balancesSnapshot) balances.set(k, v);
        poolSetting.value = poolSnapshot;
        throw error;
      }
    },
  };

  const makeService = (withQueue = true): PulseTradeService =>
    new PulseTradeService(
      tradeRepo as never,
      balanceRepo as never,
      dataSource as never,
      priceService as never,
      {} as never,
      {} as never,
      { get: () => null } as never,
      withQueue ? (settlementQueue as never) : (undefined as never),
    );

  return {
    trades,
    ledgers,
    audits,
    balances,
    queueAdds,
    repoTargets,
    poolSetting,
    seedBalance,
    makeService,
    armStealSettle: () => {
      stealSettle = true;
    },
    armBlockReset: () => {
      blockReset = true;
    },
    updateCalls: () => updateCount,
  };
}

describe('PulseTradeService — HIGH-3 admin settlement recovery', () => {
  function seedFailedScenario(h: ReturnType<typeof makeHarness>): void {
    h.trades.push(makeFailedTrade());
    // FAILED trade ka stake abhi bhi locked hai (settlement kabhi complete
    // nahi hua) — settleTrade ka BALANCE_LOCK_MISMATCH guard pass hota hai.
    h.seedBalance('user-1', '1000.000000000000000000', '100.000000000000000000');
  }

  it('recovers a SETTLEMENT_FAILED trade through the existing authoritative pipeline', async () => {
    const h = makeHarness();
    seedFailedScenario(h);
    const service = h.makeService();

    const result = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      { reason: 'ops retry after Binance outage' },
      recoveryContext,
    );

    expect(result).toMatchObject({
      tradeId: 'trade-failed-1',
      previousStatus: TradeStatus.SETTLEMENT_FAILED,
      action: 'RECOVERY_QUEUED',
      status: TradeStatus.SETTLEMENT_DELAYED,
      jobId: pulseSettlementTradeJobId('trade-failed-1'),
    });

    // Trade ab DELAYED hai — existing 1s scan/worker ise settle karega.
    expect(h.trades[0].status).toBe(TradeStatus.SETTLEMENT_DELAYED);
    expect(h.trades[0].settlementRetryCount).toBe(0);
    expect(h.trades[0].nextSettlementRetryAt).toBeNull();

    // Existing deterministic settle job reuse — koi naya job type nahi.
    expect(h.queueAdds).toHaveLength(1);
    expect(h.queueAdds[0]).toMatchObject({
      name: PULSE_SETTLEMENT_SETTLE_JOB,
      data: { tradeId: 'trade-failed-1' },
      opts: { jobId: pulseSettlementTradeJobId('trade-failed-1') },
    });

    // Audit trail with previous status + reason.
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      adminId: 'admin-1',
      action: 'PULSE_SETTLEMENT_RECOVERY',
      targetType: 'pulse_trade',
      targetId: 'trade-failed-1',
      oldValue: { status: TradeStatus.SETTLEMENT_FAILED },
      newValue: { status: TradeStatus.SETTLEMENT_DELAYED },
    });
    expect(h.audits[0].metadata).toMatchObject({
      result: 'RECOVERY_QUEUED',
      reason: 'ops retry after Binance outage',
    });
  });

  it('recovered settlement flows through the authoritative settleTrade path (full loop)', async () => {
    const h = makeHarness();
    seedFailedScenario(h);
    const service = h.makeService();

    await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    // Worker step — existing authoritative settlement (WIN: entry 50000 →
    // expiry 51000, LONG → payout = netStake(95) × 1.9 = 180.50).
    await service.settleTrade('trade-failed-1');

    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(h.trades[0].result).toBe('WIN');
    const settlementLedgers = h.ledgers.filter(
      (l) =>
        l.referenceType ===
        PULSE_SETTLEMENT_POLICY.ledger.settlementReferenceType,
    );
    expect(settlementLedgers).toHaveLength(1);
    expect(settlementLedgers[0].referenceId).toBe('trade-failed-1');
    // Balance credit sirf settlement tx se: available 1000 + 180.50.
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1180.500000000000000000',
    );
    expect(h.balances.get('user-1')?.lockedBalance).toBe(Z);
    expect(h.balances.get('user-1')?.totalBalance).toBe(
      '1080.500000000000000000',
    );
  });

  it('recovery NEVER directly credits balance or inserts payout ledger', async () => {
    const h = makeHarness();
    seedFailedScenario(h);
    const service = h.makeService();

    await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    // Recovery sirf trade row + audit + queue touch karta hai — na Balance,
    // na LedgerEntry repository access.
    expect(h.repoTargets).not.toContain('Balance');
    expect(h.repoTargets).not.toContain('LedgerEntry');
    expect(h.ledgers).toHaveLength(0);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1000.000000000000000000',
    );
    expect(h.balances.get('user-1')?.lockedBalance).toBe(
      '100.000000000000000000',
    );
  });

  it('SETTLED trade recovery request is idempotent: no payout, no ledger, no downgrade', async () => {
    const h = makeHarness();
    const settled = makeFailedTrade({
      status: TradeStatus.SETTLED,
      result: 'WIN',
      exitPrice: '51000.000000000000000000',
      settledAt: NOW,
    });
    h.trades.push(settled);
    h.seedBalance('user-1', '1180.500000000000000000', Z);
    const service = h.makeService();

    const result = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    expect(result).toMatchObject({
      action: 'ALREADY_SETTLED',
      previousStatus: TradeStatus.SETTLED,
      status: TradeStatus.SETTLED,
      jobId: null,
    });
    // Koi mutation nahi: update call hi nahi hua, queue add nahi hua.
    expect(h.updateCalls()).toBe(0);
    expect(h.queueAdds).toHaveLength(0);
    expect(h.ledgers).toHaveLength(0);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    // Audited as ALREADY_SETTLED.
    expect(h.audits[0].metadata).toMatchObject({ result: 'ALREADY_SETTLED' });
    expect(h.audits[0].newValue).toEqual({ status: TradeStatus.SETTLED });
  });

  it.each([
    [TradeStatus.REJECTED, 'rejected trade'],
    [TradeStatus.CANCELLED, 'cancelled trade'],
    [TradeStatus.ACCEPTED, 'active trade'],
    [TradeStatus.SETTLEMENT_DELAYED, 'already-pending trade'],
  ])('%s cannot be force-recovered through this endpoint', async (status) => {
    const h = makeHarness();
    h.trades.push(makeFailedTrade({ status }));
    h.seedBalance('user-1', '1000.000000000000000000', '100.000000000000000000');
    const service = h.makeService();

    await expect(
      service.requestSettlementRecovery(
        'admin-1',
        'trade-failed-1',
        {},
        recoveryContext,
      ),
    ).rejects.toThrow(ConflictException);

    // Status untouched, no queue, no financial mutation; audited rejection.
    expect(h.trades[0].status).toBe(status);
    expect(h.queueAdds).toHaveLength(0);
    expect(h.ledgers).toHaveLength(0);
    expect(h.audits[0].metadata).toMatchObject({
      result: 'REJECTED_NOT_RECOVERABLE',
    });
  });

  it('race: worker settles during recovery → idempotent ALREADY_SETTLED, no downgrade', async () => {
    const h = makeHarness();
    seedFailedScenario(h);
    h.armStealSettle(); // UPDATE affected=0, row → SETTLED (worker jeet gaya)
    const service = h.makeService();

    const result = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    expect(result).toMatchObject({
      action: 'ALREADY_SETTLED',
      status: TradeStatus.SETTLED,
      jobId: null,
    });
    // FAILED → SETTLED overwrite nahi hua; koi re-queue nahi.
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(h.queueAdds).toHaveLength(0);
  });

  it('race: state changed during recovery → conflict, no forced transition', async () => {
    const h = makeHarness();
    seedFailedScenario(h);
    h.armBlockReset(); // UPDATE affected=0, row FAILED par hi rehta hai
    const service = h.makeService();

    await expect(
      service.requestSettlementRecovery(
        'admin-1',
        'trade-failed-1',
        {},
        recoveryContext,
      ),
    ).rejects.toThrow(/SETTLEMENT_RECOVERY_STATE_CHANGED/);

    expect(h.trades[0].status).toBe(TradeStatus.SETTLEMENT_FAILED);
    expect(h.queueAdds).toHaveLength(0);
  });

  it('invalid trade id returns the project not-found response', async () => {
    const h = makeHarness();
    const service = h.makeService();

    await expect(
      service.requestSettlementRecovery(
        'admin-1',
        'missing-trade',
        {},
        recoveryContext,
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.requestSettlementRecovery(
        'admin-1',
        'missing-trade',
        {},
        recoveryContext,
      ),
    ).rejects.toThrow('TRADE_NOT_FOUND');
  });

  it('queue outage falls back to the 1s expiry scan without blocking recovery', async () => {
    const h = makeHarness({ queueFails: true });
    seedFailedScenario(h);
    const service = h.makeService();

    const result = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    expect(result).toMatchObject({
      action: 'RECOVERY_QUEUED',
      status: TradeStatus.SETTLEMENT_DELAYED,
      jobId: null,
    });
    expect(h.trades[0].status).toBe(TradeStatus.SETTLEMENT_DELAYED);
    expect(h.audits[0].metadata).toMatchObject({ result: 'RECOVERY_QUEUED' });
  });

  it('recovery works without an injected queue (optional dependency)', async () => {
    const h = makeHarness({ noQueue: true });
    seedFailedScenario(h);
    const service = h.makeService(false);

    const result = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    expect(result).toMatchObject({
      action: 'RECOVERY_QUEUED',
      status: TradeStatus.SETTLEMENT_DELAYED,
      jobId: null,
    });
  });

  it('recovery failure after queueing does not corrupt a previously successful settlement', async () => {
    // Recovery → settle → dobara recovery: ALREADY_SETTLED — CRITICAL-1/2
    // guards ke saath koi downgrade/double-payout nahi.
    const h = makeHarness();
    seedFailedScenario(h);
    const service = h.makeService();

    await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );
    await service.settleTrade('trade-failed-1');
    const ledgerCountAfterSettle = h.ledgers.length;

    const repeat = await service.requestSettlementRecovery(
      'admin-1',
      'trade-failed-1',
      {},
      recoveryContext,
    );

    expect(repeat.action).toBe('ALREADY_SETTLED');
    expect(h.ledgers).toHaveLength(ledgerCountAfterSettle);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1180.500000000000000000',
    );
  });

  it('admin endpoint is registered behind JwtAuthGuard + AdminGuard with bounded reason', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/pulse-portfolio.controller.ts'),
      'utf8',
    );
    expect(src).toContain('admin/trades/:tradeId/settlement-retry');
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*AdminGuard\)/);
    // Recovery route ke turant baad guards hon — route-level protection.
    const routeIndex = src.indexOf('admin/trades/:tradeId/settlement-retry');
    const guardIndex = src.indexOf(
      '@UseGuards(JwtAuthGuard, AdminGuard)',
      routeIndex,
    );
    expect(guardIndex).toBeGreaterThan(routeIndex);
    expect(guardIndex - routeIndex).toBeLessThan(200);

    const dtoSrc = readFileSync(
      join(__dirname, '../dtos/admin-settlement-recovery.dto.ts'),
      'utf8',
    );
    expect(dtoSrc).toContain('@MaxLength(300)');
    expect(dtoSrc).toContain('@IsOptional()');
  });
});

