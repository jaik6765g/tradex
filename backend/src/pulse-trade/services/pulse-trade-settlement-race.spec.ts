/**
 * TRADEX PULSE TRADE - CRITICAL settlement status-race tests.
 * Scope: CRITICAL-1 + CRITICAL-2 only. No DB/Redis/blockchain I/O -
 * all repositories are in-memory mocks.
 */
import { QueryFailedError } from 'typeorm';

import { TradeStatus } from '../constants/enums';
import { PulseTradeService } from './pulse-trade.service';

type TradeRow = {
  id: string;
  userId: string;
  pair: string;
  direction: 'LONG' | 'SHORT';
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

type LedgerRow = {
  id: string;
  userId: string;
  type: string;
  amount: string;
  referenceId: string;
  referenceType: string;
};

const STAKE = '100.000000000000000000';

function makeTrade(o: Partial<TradeRow> = {}): TradeRow {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: 'trade-1',
    userId: 'user-1',
    pair: 'BTC/USDT',
    direction: 'LONG',
    duration: 60,
    amount: STAKE,
    entryPrice: '50000.000000000000000000',
    exitPrice: null,
    result: null,
    status: TradeStatus.ACCEPTED,
    createdAt: now,
    expiryAt: new Date(now.getTime() - 60000),
    settledAt: null,
    settlementRetryCount: 0,
    settlementFailureReason: null,
    lastSettlementAttemptAt: null,
    nextSettlementRetryAt: null,
    updatedAt: now,
    ...o,
  };
}

function uniqueViolation(constraint: string): QueryFailedError {
  const driver = Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint,
  });
  return new QueryFailedError('INSERT INTO ...', [], driver);
}


function statusList(cond: unknown): string[] | null {
  if (cond === undefined) return null;
  const raw =
    cond && typeof cond === 'object'
      ? ((cond as { value?: unknown }).value ??
        (cond as { values?: unknown }).values)
      : cond;
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((v) => String(v));
}

function makeHarness(o: {
  trades?: TradeRow[];
  ledgers?: LedgerRow[];
  price?: string;
} = {}) {
  const trades: TradeRow[] = (o.trades ?? [makeTrade()]).map((t) => ({
    ...t,
  }));
  const ledgers: LedgerRow[] = (o.ledgers ?? []).map((l) => ({ ...l }));
  let seq = ledgers.length;

  const match = (where: {
    id?: string;
    status?: unknown;
  }): TradeRow | null =>
    trades.find((t) => {
      if (where.id !== undefined && t.id !== where.id) return false;
      const list = statusList(where.status);
      if (list && !list.includes(t.status)) return false;
      return true;
    }) ?? null;

  const tradeRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  } = {
    findOne: jest.fn(async (q: { where?: { id?: string } }) =>
      match(q?.where ?? {}),
    ),
    update: jest.fn(
      async (criteria: { id?: string }, partial: Partial<TradeRow>) => {
        const row = match(criteria ?? {});
        if (!row) return { affected: 0 };
        Object.assign(row, partial);
        row.updatedAt = new Date();
        return { affected: 1 };
      },
    ),
    create: jest.fn((x: Partial<TradeRow>) => ({ ...x })),
    save: jest.fn(async (e: TradeRow) => {
      const i = trades.findIndex((t) => t.id === e.id);
      if (i >= 0) trades[i] = { ...e };
      else trades.push({ ...e });
      return e;
    }),
  };

  const ledgerRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  } = {
    findOne: jest.fn(
      async (q: {
        where?: { referenceId?: string; referenceType?: string };
      }) => {
        const w = q?.where ?? {};
        return (
          ledgers.find(
            (l) =>
              (w.referenceId === undefined ||
                l.referenceId === w.referenceId) &&
              (w.referenceType === undefined ||
                l.referenceType === w.referenceType),
          ) ?? null
        );
      },
    ),
    create: jest.fn((x: Partial<LedgerRow>) => ({
      id: `ledger-${++seq}`,
      ...x,
    })),
    save: jest.fn(async (e: LedgerRow) => {
      if (
        e.referenceType === 'TRADE_SETTLEMENT' &&
        ledgers.some(
          (l) =>
            l.referenceId === e.referenceId &&
            l.referenceType === 'TRADE_SETTLEMENT',
        )
      ) {
        throw uniqueViolation(
          'IDX_ledger_trade_settlement_reference_unique',
        );
      }
      ledgers.push({ ...e });
      return e;
    }),
  };

  const balances = new Map<string, Record<string, string>>();
  const seed = (userId: string, stake: string): void => {
    balances.set(userId, {
      userId,
      availableBalance: '1000.000000000000000000',
      lockedBalance: stake,
      gameLocked: '0.000000000000000000',
      tradingLocked: stake,
      withdrawalLocked: '0.000000000000000000',
      totalBalance: '1000.000000000000000000',
    });
  };

  const balanceRepo = {
    findOne: jest.fn(
      async (q: { where?: { userId?: string } }) =>
        balances.get(q?.where?.userId ?? '') ?? null,
    ),
    create: jest.fn((x: Record<string, string>) => ({ ...x })),
    save: jest.fn(async (e: Record<string, string> & { userId: string }) => {
      balances.set(e.userId, { ...e });
      return e;
    }),
  };

  const settings = new Map<string, Record<string, string | null>>([
    [
      'PULSE_LIQUIDITY_POOL_BALANCE',
      {
        key: 'PULSE_LIQUIDITY_POOL_BALANCE',
        value: '1000000',
        updatedBy: null,
      },
    ],
  ]);
  const settingRepo = {
    findOne: jest.fn(
      async (q: { where?: { key?: string } }) =>
        settings.get(q?.where?.key ?? '') ?? null,
    ),
    create: jest.fn((x: Record<string, string | null>) => ({ ...x })),
    save: jest.fn(async (e: Record<string, string | null> & { key: string }) => {
      settings.set(e.key, { ...e });
      return e;
    }),
  };

  const userRepo = { findOne: jest.fn(async () => null) };

  const forEntity = (entity: { name?: string }): unknown => {
    const n = entity?.name ?? '';
    if (n === 'Trade') return tradeRepo;
    if (n === 'LedgerEntry') return ledgerRepo;
    if (n === 'Balance') return balanceRepo;
    if (n === 'AdminSetting') return settingRepo;
    if (n === 'User') return userRepo;
    return tradeRepo;
  };
  const manager = { getRepository: jest.fn((e: { name?: string }) => forEntity(e)) };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
      fn(manager),
    ),
    getRepository: jest.fn((e: { name?: string }) => forEntity(e)),
  };
  const priceService = {
    getAuthoritativePriceIndex: jest.fn(async (pair: string) => ({
      pair,
      indexPrice: o.price ?? '51000.000000000000000000',
      calculatedAt: new Date(),
      aggregationMethod: 'SIMPLE_AVERAGE',
      sourcesUsed: ['BINANCE'],
      providerSamples: [],
      rejectedSources: [],
      openDecisions: [],
    })),
  };

  const svc = new PulseTradeService(
    tradeRepo as never,
    balanceRepo as never,
    dataSource as never,
    priceService as never,
    { evaluatePreTradeRisk: jest.fn() } as never,
    { checkTradeLiquidity: jest.fn() } as never,
    { get: jest.fn(() => undefined) } as never,
  );

  return { svc, trades, ledgers, tradeRepo, priceService, seed };
}


describe('Pulse settlement status-race guards (CRITICAL-1 / CRITICAL-2)', () => {
  it('CRITICAL-1: markTradeSettlementFailed() never downgrades SETTLED', async () => {
    const h = makeHarness({
      trades: [makeTrade({ status: TradeStatus.SETTLED })],
    });
    const updated = await h.svc.markTradeSettlementFailed(
      'trade-1',
      'boom',
      5,
      5,
    );
    expect(updated).toBe(false);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
  });

  it('CRITICAL-1: markTradeSettlementFailed() marks active states FAILED', async () => {
    for (const status of [
      TradeStatus.ACCEPTED,
      TradeStatus.SETTLEMENT_DELAYED,
    ]) {
      const h = makeHarness({ trades: [makeTrade({ status })] });
      const updated = await h.svc.markTradeSettlementFailed(
        'trade-1',
        'retries exhausted',
        5,
        5,
      );
      expect(updated).toBe(true);
      expect(h.trades[0].status).toBe(TradeStatus.SETTLEMENT_FAILED);
    }
  });

  it('CRITICAL-1: REJECTED / CANCELLED / FAILED never overwritten', async () => {
    for (const status of [
      TradeStatus.REJECTED,
      TradeStatus.CANCELLED,
      TradeStatus.SETTLEMENT_FAILED,
    ]) {
      const h = makeHarness({ trades: [makeTrade({ status })] });
      const updated = await h.svc.markTradeSettlementFailed(
        'trade-1',
        'late failure',
        5,
        5,
      );
      expect(updated).toBe(false);
      expect(h.trades[0].status).toBe(status);
    }
  });

  it('CRITICAL-2: concurrent settleTrade() converges on SETTLED, one ledger', async () => {
    const h = makeHarness({});
    h.seed('user-1', STAKE);
    const results = await Promise.allSettled([
      h.svc.settleTrade('trade-1'),
      h.svc.settleTrade('trade-1'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(
      h.ledgers.filter((l) => l.referenceType === 'TRADE_SETTLEMENT'),
    ).toHaveLength(1);
  });

  it('CRITICAL-2: settled-then-reprocessed trade writes nothing new', async () => {
    const h = makeHarness({
      trades: [
        makeTrade({
          status: TradeStatus.SETTLED,
          result: 'WIN',
          exitPrice: '51000.000000000000000000',
          settledAt: new Date('2026-09-01T00:01:00.000Z'),
        }),
      ],
      ledgers: [
        {
          id: 'ledger-1',
          userId: 'user-1',
          type: 'TRADE_PROFIT',
          amount: '80.500000000000000000',
          referenceId: 'trade-1',
          referenceType: 'TRADE_SETTLEMENT',
        },
      ],
    });
    h.seed('user-1', STAKE);
    const before = h.ledgers.length;
    const res = await h.svc.settleTrade('trade-1');
    expect(res.tradeId).toBe('trade-1');
    expect(h.ledgers).toHaveLength(before);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(h.tradeRepo.update).not.toHaveBeenCalled();
  });

  it('CRITICAL-1: exhausted-retries handler keeps late SETTLED', async () => {
    const h = makeHarness({
      trades: [makeTrade({ status: TradeStatus.SETTLED })],
    });
    const updated = await h.svc.markTradeSettlementFailed(
      'trade-1',
      'Pulse settle job failed: Binance timeout',
      5,
      5,
    );
    expect(updated).toBe(false);
    expect(h.trades[0].status).toBe(TradeStatus.SETTLED);
    expect(h.trades[0].settlementFailureReason).toBeNull();
  });

  it('status machine: terminal preserved; price failure still DELAYED', async () => {
    for (const status of [
      TradeStatus.SETTLED,
      TradeStatus.REJECTED,
      TradeStatus.CANCELLED,
      TradeStatus.SETTLEMENT_FAILED,
    ]) {
      const h = makeHarness({ trades: [makeTrade({ status })] });
      const updated = await h.svc.markTradeSettlementFailed(
        'trade-1',
        'x',
        5,
        5,
      );
      expect(updated).toBe(false);
      expect(h.trades[0].status).toBe(status);
    }
    const h2 = makeHarness({
      trades: [makeTrade({ status: TradeStatus.ACCEPTED })],
    });
    h2.priceService.getAuthoritativePriceIndex.mockRejectedValueOnce(
      new Error('Binance timeout'),
    );
    await expect(h2.svc.settleTrade('trade-1')).rejects.toThrow();
    expect(h2.trades[0].status).toBe(TradeStatus.SETTLEMENT_DELAYED);
  });
});
