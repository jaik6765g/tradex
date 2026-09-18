/**
 * TRADEX PULSE TRADE - HIGH-1 risk/liquidity TOCTOU tests.
 *
 * Scope: sirf placement risk/liquidity serialization. Koi DB/Redis/
 * blockchain I/O nahi. Concurrency primitive in-memory promise-chain mutex
 * hai jo pg_advisory_xact_lock ke transaction-scoped semantics mirror
 * karta hai (lock tx-start par acquire, commit/rollback/exception par
 * release) - RiskService/LiquidityService REAL production instances hain,
 * mocks nahi.
 */
import { Decimal } from 'decimal.js';
import { QueryFailedError } from 'typeorm';

import { TradeStatus } from '../constants/enums';
import { Trade } from '../entities/trade.entity';
import { Balance } from '../../balances/balance.entity';
import { LedgerEntry } from '../../ledger/ledger.entity';
import { AdminSetting } from '../../admin/entities/admin-setting.entity';
import { User } from '../../users/user.entity';
import { RiskService } from './risk-service';
import { LiquidityService } from './liquidity-service';
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
  clientRequestId?: string;
  /** HIGH-2 test-harness visibility: in-tx save → commit hone tak flag. */
  pendingCommit?: boolean;
};

function makeTrade(o: Partial<TradeRow> = {}): TradeRow {
  const now = new Date('2026-09-01T00:00:00.000Z');
  return {
    id: o.id ?? 'seed-1',
    userId: 'user-1',
    pair: 'BTC/USDT',
    direction: 'LONG',
    duration: 60,
    amount: '0.000000000000000000',
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

/**
 * Promise-chain mutex - pg_advisory_xact_lock ke analogous: acquire par
 * release-fn milta hai; jab tak release nahi hua, same key ka next acquire
 * block hota hai. Ye App-level serialization prove karta hai jo production
 * me Postgres advisory lock karta hai.
 */
function createAdvisoryLocks() {
  const tails = new Map<string, Promise<void>>();
  let held = 0;

  const acquire = (key: string): Promise<() => void> => {
    const tail = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const next = tail.then(
      () =>
        new Promise<void>((r) => {
          held += 1;
          r();
        }),
    );
    tails.set(
      key,
      next.then(() => gate),
    );
    return next.then(() => {
      return () => {
        held -= 1;
        release();
      };
    });
  };

  return {
    acquire,
    heldCount: () => held,
  };
}

function makeHarness(opts: {
  trades?: TradeRow[];
  poolValue?: string;
  failLedgerSaveOnce?: boolean;
  users?: Record<string, string | null>;
  /** HIGH-2 failure injection — har point apni turn par exactly once throw karta hai. */
  failBalanceSaveOnce?: boolean;
  failTradeSaveOnce?: boolean;
  failLedgerSaveAtIndex?: number;
  failPoolSaveOnce?: boolean;
  /** HIGH-4: naye placements ka trade id pehle wale se collide karao (replay simulation). */
  collideWithFirstTrade?: boolean;
  /** HIGH-4: pre-check ko concurrent-insert invisibility simulate karao. */
  hideUnallocatedFromPreCheck?: boolean;
  /** HIGH-4: agla ledger save is constraint ke saath real 23505 throw kare. */
  failLedger23505WithConstraint?: string;
} = {}) {
  const trades: TradeRow[] = (opts.trades ?? []).map((t) => ({ ...t }));
  const ledgers: Array<Record<string, unknown>> = [];
  const balances = new Map<string, Record<string, string>>();
  let tradeSeq = 0;
  let ledgerSeq = 0;
  let ledgerFailArmed = opts.failLedgerSaveOnce ?? false;
  let balanceFailArmed = opts.failBalanceSaveOnce ?? false;
  let tradeFailArmed = opts.failTradeSaveOnce ?? false;
  let ledgerFailIndexArmed = opts.failLedgerSaveAtIndex ?? null;
  let poolFailArmed = opts.failPoolSaveOnce ?? false;
  let ledger23505Constraint: string | null =
    opts.failLedger23505WithConstraint ?? null;
  let forcedTradeId: string | null = opts.collideWithFirstTrade
    ? 'pulse-new-1'
    : null;

  const locks = createAdvisoryLocks();

  const seed = (
    userId: string,
    available: string,
    locked: string = '0.000000000000000000',
  ): void => {
    balances.set(userId, {
      userId,
      availableBalance: available,
      lockedBalance: locked,
      gameLocked: '0.000000000000000000',
      tradingLocked: locked,
      withdrawalLocked: '0.000000000000000000',
      totalBalance: available,
    });
  };

  const matchTrade = (
    where: {
      id?: string;
      status?: unknown;
      userId?: string;
      clientRequestId?: string;
    },
    committedOnly: boolean,
  ): TradeRow | null =>
    trades.find((t) => {
      if (committedOnly && t.pendingCommit) return false;
      if (where.id !== undefined && t.id !== where.id) return false;
      const raw =
        where.status && typeof where.status === 'object'
          ? ((where.status as { value?: unknown }).value ??
            (where.status as { values?: unknown }).values)
          : where.status;
      if (raw !== undefined) {
        const list = (Array.isArray(raw) ? raw : [raw]).map(String);
        if (!list.includes(t.status)) return false;
      }
      if (where.userId !== undefined && t.userId !== where.userId)
        return false;
      if (
        where.clientRequestId !== undefined &&
        t.clientRequestId !== where.clientRequestId
      )
        return false;
      return true;
    }) ?? null;

  // READ COMMITTED visibility model: in-tx INSERT kiye gaye trades commit
  // hone tak sirf usi transaction ko dikhte hain (all-view); pre-tx checks /
  // replay lookups ko committed state dikhta hai — real Postgres jaisa.
  let currentTxPending: TradeRow[] | null = null;

  const makeTradeView = (committedOnly: boolean) => ({
    findOne: async (q: {
      where?: {
        id?: string;
        status?: unknown;
        userId?: string;
        clientRequestId?: string;
      };
    }) => matchTrade(q?.where ?? {}, committedOnly),
    update: async () => {},
    create: (x: Partial<TradeRow>) => ({
      id: forcedTradeId ?? `pulse-new-${++tradeSeq}`,
      ...x,
    }),
    save: async (e: TradeRow) => {
      if (tradeFailArmed) {
        tradeFailArmed = false;
        throw new Error('TRADE_INSERT_FAILURE');
      }
      const i = trades.findIndex((t) => t.id === e.id);
      if (i >= 0) {
        Object.assign(trades[i], e);
        return trades[i];
      }
      if (!committedOnly) {
        e.pendingCommit = true;
        currentTxPending?.push(e);
      }
      trades.push(e);
      return e;
    },
    createQueryBuilder: () => {
      const conds: Array<{ cond: string; params?: Record<string, unknown> }> =
        [];
      let alias = 'value';
      const qb = {
        select: (_sql: string, a: string) => {
          alias = a;
          return qb;
        },
        where: (cond: string, params?: Record<string, unknown>) => {
          conds.push({ cond, params });
          return qb;
        },
        andWhere: (cond: string, params?: Record<string, unknown>) => {
          conds.push({ cond, params });
          return qb;
        },
        getRawOne: async () => {
          const merged: Record<string, unknown> = {};
          let statusFilter: string[] | null = null;
          for (const c of conds) {
            Object.assign(merged, c.params ?? {});
            if (c.cond.includes('status IN')) {
              const raw = (c.params as { openStatuses?: unknown })
                ?.openStatuses;
              statusFilter = (Array.isArray(raw) ? raw : []).map(String);
            }
          }
          const sum = trades.reduce((acc, t) => {
            if (committedOnly && t.pendingCommit) return acc;
            if (statusFilter && !statusFilter.includes(t.status)) return acc;
            if (
              merged.pair !== undefined &&
              t.pair !== (merged.pair as string)
            )
              return acc;
            if (
              merged.userId !== undefined &&
              t.userId !== (merged.userId as string)
            )
              return acc;
            if (
              merged.durationSeconds !== undefined &&
              t.duration !== (merged.durationSeconds as number)
            )
              return acc;
            return acc.plus(t.amount);
          }, new Decimal(0));
          return { [alias]: sum.toFixed(18) };
        },
      };
      return qb;
    },
  });

  const tradeRepo = makeTradeView(true); // outer/pre-tx: committed view
  const inTxTradeRepo = makeTradeView(false); // transaction view

  const poolSetting: { key: string; value: string } = {
    key: 'PULSE_LIQUIDITY_POOL_BALANCE',
    value: opts.poolValue ?? '1000000.000000000000000000',
  };

  const users: Record<string, string | null> = opts.users ?? {};
  const events: string[] = [];

  const balanceRepo = {
    findOne: async (q?: { where?: { userId?: string } }) =>
      balances.get(q?.where?.userId ?? '') ?? null,
    create: (x: Record<string, unknown>) => ({ ...x }),
    save: async (e: { userId: string } & Record<string, unknown>) => {
      if (balanceFailArmed) {
        balanceFailArmed = false;
        throw new Error('BALANCE_SAVE_FAILURE');
      }
      balances.set(e.userId, e as Record<string, string>);
      return e;
    },
  };

  const UNALLOCATED_REFERRAL_REFERENCE_TYPE =
    'TRADE_FEE_UNALLOCATED_TO_LIQUIDITY_POOL';

  const ledgerRepo = {
    find: async (q?: { where?: Record<string, unknown> }) => {
      const where = q?.where ?? {};
      return ledgers.filter((l) => {
        for (const [key, raw] of Object.entries(where)) {
          let expected: unknown = raw;
          if (
            raw !== null &&
            typeof raw === 'object' &&
            typeof (raw as { value?: unknown }).value !== 'undefined'
          ) {
            // TypeORM FindOperator (Like) — pattern ko regex me convert.
            const pattern = String((raw as { value: unknown }).value);
            const regex = new RegExp(
              `^${pattern
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*')}$`,
            );
            if (
              !regex.test(String((l as Record<string, unknown>)[key] ?? ''))
            ) {
              return false;
            }
            continue;
          }
          if ((l as Record<string, unknown>)[key] !== expected) return false;
        }
        return true;
      });
    },
    findOne: async (q?: {
      where?: { referenceType?: string; referenceId?: string };
    }) => {
      if (
        opts.hideUnallocatedFromPreCheck &&
        q?.where?.referenceType === UNALLOCATED_REFERRAL_REFERENCE_TYPE
      ) {
        // Simulate: concurrent insert abhi is tx ko visible nahi (race).
        return null;
      }
      return (
        ledgers.find(
          (l) =>
            l.referenceType === q?.where?.referenceType &&
            l.referenceId === q?.where?.referenceId,
        ) ?? null
      );
    },
    create: (x: Record<string, unknown>) => ({ id: `l-${++ledgerSeq}`, ...x }),
    save: async (e: Record<string, any>) => {
      if (ledgerFailArmed) {
        ledgerFailArmed = false;
        throw new Error('LEDGER_WRITE_FAILURE');
      }
      if (
        ledgerFailIndexArmed !== null &&
        ledgers.length === ledgerFailIndexArmed
      ) {
        const idx = ledgerFailIndexArmed;
        ledgerFailIndexArmed = null;
        throw new Error(`LEDGER_WRITE_FAILURE_AT_INDEX_${idx}`);
      }
      if (ledger23505Constraint) {
        const constraint = ledger23505Constraint;
        ledger23505Constraint = null;
        // Real TypeORM QueryFailedError — production classification isi par
        // chalti hai (error instanceof QueryFailedError). driverError.message
        // hi error message banta hai, isliye constraint name usme rakhte hain.
        throw new QueryFailedError('INSERT INTO ledger_entries', [], {
          code: '23505',
          constraint,
          message: `duplicate key value violates unique constraint "${constraint}"`,
        } as unknown as Error);
      }
      if (
        e.referenceType === UNALLOCATED_REFERRAL_REFERENCE_TYPE &&
        ledgers.some(
          (l) =>
            l.referenceType === e.referenceType &&
            l.referenceId === e.referenceId,
        )
      ) {
        // HIGH-4 DB backstop simulation (migration 1768 unique index).
        throw new QueryFailedError('INSERT INTO ledger_entries', [], {
          code: '23505',
          constraint: 'IDX_ledger_trade_fee_unallocated_reference_unique',
        } as unknown as Error);
      }
      ledgers.push(e);
      events.push('ledger');
      return e;
    },
  };

  const settingRepo = {
    findOne: async (q?: { where?: { key?: string } }) =>
      !q?.where?.key || q.where.key === poolSetting.key
        ? { ...poolSetting }
        : null,
    create: (x: Record<string, unknown>) => ({ ...x }),
    save: async (e: { value: string }) => {
      if (poolFailArmed) {
        poolFailArmed = false;
        throw new Error('POOL_PERSIST_FAILURE');
      }
      poolSetting.value = e.value;
      return e;
    },
  };

  const userRepo = {
    findOne: async (q?: { where?: { id?: string } }) => {
      const id = q?.where?.id;
      if (!id || !(id in users)) return null;
      return { id, referredBy: users[id] ?? null };
    },
  };

  const dataSource = {
    getRepository: (target: unknown) => {
      if (target === AdminSetting) return settingRepo;
      if (target === LedgerEntry) return ledgerRepo;
      if (target === Balance) return balanceRepo;
      return null;
    },
    transaction: async <T>(
      cb: (manager: {
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
        getRepository: (target: unknown) => unknown;
      }) => Promise<T>,
    ): Promise<T> => {
      // Transaction-scoped state: on rollback (throw) every mutation made
      // through the manager is undone — mirrors real DB atomicity.
      const tradesLen = trades.length;
      const ledgersLen = ledgers.length;
      // Deep-copy values: production mutates the balance object in place, so
      // a shallow Map copy would keep referencing the mutated object.
      const balancesSnapshot = new Map(
        [...balances].map(([k, v]) => [k, { ...v }]),
      );
      const poolSnapshot = poolSetting.value;
      const txReleases: Array<() => void> = [];
      const manager = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('pg_advisory_xact_lock')) {
            const key = String(params?.[0] ?? 'unknown');
            events.push(`lock:${key}`);
            // Transaction-scoped semantics: released by the tx finally block.
            const release = await locks.acquire(key);
            txReleases.push(release);
            return [{ locked: true }];
          }
          throw new Error(`Unexpected manager.query: ${sql}`);
        },
        getRepository: (target: unknown) => {
          if (target === Trade) return inTxTradeRepo;
          if (target === Balance) return balanceRepo;
          if (target === LedgerEntry) return ledgerRepo;
          if (target === AdminSetting) return settingRepo;
          if (target === User) return userRepo;
          throw new Error('Unexpected repository target');
        },
      };
      const txPending: TradeRow[] = [];
      currentTxPending = txPending;
      try {
        const result = await cb(manager);
        // COMMIT: in-tx writes ab sab observers ko dikhte hain.
        for (const t of txPending) delete t.pendingCommit;
        return result;
      } catch (error) {
        // ROLLBACK: har in-tx mutation undo — trade, ledger, balance, pool.
        trades.length = tradesLen;
        ledgers.length = ledgersLen;
        balances.clear();
        for (const [k, v] of balancesSnapshot) balances.set(k, v);
        poolSetting.value = poolSnapshot;
        throw error;
      } finally {
        currentTxPending = null;
        for (const release of txReleases) release();
        events.push('tx-end');
      }
    },
  };

  return {
    trades,
    ledgers,
    balances,
    poolSetting,
    locks,
    events,
    dataSource,
    tradeRepo,
    inTxTradeRepo,
    balanceRepo,
    seed,
    poolValue: () => poolSetting.value,
    /** HIGH-4: naye placements pehle wale trade id se collide karao. */
    armCollision: () => {
      forcedTradeId = 'pulse-new-1';
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Service factory — REAL RiskService/LiquidityService, no mocks     */
/* ------------------------------------------------------------------ */

function makeService(h: ReturnType<typeof makeHarness>): PulseTradeService {
  const priceService = {
    getAuthoritativePriceIndex: async () => ({
      indexPrice: '50000.000000000000000000',
      calculatedAt: new Date(),
    }),
  };

  const configService = { get: () => null };

  return new PulseTradeService(
    h.tradeRepo as never,
    h.balanceRepo as never,
    h.dataSource as never,
    priceService as never,
    new RiskService(),
    new LiquidityService(),
    configService as never,
    {
      recordWageredVolume: jest.fn(async () => ({ status: 'COUNTED' })),
    } as never,
  );
}

function makeDto(o: {
  amount: string;
  clientRequestId: string;
  direction?: 'LONG' | 'SHORT';
  duration?: string;
  symbol?: string;
}): Record<string, unknown> {
  return {
    symbol: o.symbol ?? 'BTC/USDT',
    direction: o.direction ?? 'LONG',
    duration: o.duration ?? '1M',
    amount: o.amount,
    clientRequestId: o.clientRequestId,
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met before timeout');
    }
    await sleep(5);
  }
}

function exposureSum(
  trades: Array<{ amount: string; status: string }>,
): Decimal {
  return trades
    .filter((t) => t.status === TradeStatus.ACCEPTED)
    .reduce((acc, t) => acc.plus(t.amount), new Decimal(0));
}

describe('PulseTradeService — HIGH-1 placement risk/liquidity TOCTOU', () => {
  it('serialises concurrent placements: fresh authoritative exposure rejects the second trade', async () => {
    // Realistic model values: user exposure limit = 15000 TDX (RiskService
    // default). Two concurrent 8000 TDX placements by the same user: the
    // first commits, the second must re-read exposure AFTER acquiring the
    // advisory lock and see 8000 -> projected 16000 > 15000 -> rejected.
    const h = makeHarness();
    h.seed('user-1', '100000.000000000000000000');
    const service = makeService(h);

    const first = service.placeTrade(
      'user-1',
      makeDto({ amount: '8000', clientRequestId: 'cr-1' }) as never,
    );
    // Deterministic interleaving: launch the second placement only once the
    // first is inside the transaction (advisory lock held).
    await waitFor(() => h.events.some((e) => e.startsWith('lock:')));

    const second = service.placeTrade(
      'user-1',
      makeDto({ amount: '8000', clientRequestId: 'cr-2' }) as never,
    );

    await expect(first).resolves.toMatchObject({
      trade: { stake: '8000.000000000000000000' },
    });
    await expect(second).rejects.toThrow(/User exposure would exceed/);

    // Final authoritative exposure stays within the 15000 limit.
    expect(exposureSum(h.trades).toNumber()).toBe(8000);

    // Strict serialisation: the first transaction fully ended (tx-end) before
    // the second placement acquired the same advisory lock.
    const firstTxEnd = h.events.indexOf('tx-end');
    const secondLock = h.events.lastIndexOf('lock:pulse-placement-risk');
    expect(firstTxEnd).toBeGreaterThanOrEqual(0);
    expect(secondLock).toBeGreaterThan(firstTxEnd);

    // Exactly one placement mutated money state: one trade, one gross debit.
    expect(h.trades).toHaveLength(1);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '92000.000000000000000000',
    );
  });

  it('allows a placement at the exact user-exposure boundary (14000 + 1000 = 15000)', async () => {
    const h = makeHarness({
      trades: [
        makeTrade({ id: 'seed-14000', userId: 'user-1', amount: '14000' }),
      ],
    });
    h.seed('user-1', '50000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '1000', clientRequestId: 'cr-b' }) as never,
      ),
    ).resolves.toMatchObject({
      trade: { stake: '1000.000000000000000000' },
    });

    expect(exposureSum(h.trades).toNumber()).toBe(15000);
  });

  it('serialises concurrent liquidity checks: stale snapshots cannot exceed utilisation limit', async () => {
    // Pool 100000, reserved 72000 (seeded on a different pair/duration so the
    // liquidity utilisation limit is the binding constraint): available =
    // 28000. First 8000 TDX placement -> projected utilisation exactly 80%
    // (allowed boundary). Second must re-read fresh reserved 80000 -> 88% >
    // 80% -> rejected.
    const h = makeHarness({
      poolValue: '100000.000000000000000000',
      trades: [
        makeTrade({
          id: 'seed-liq',
          userId: 'user-2',
          pair: 'ETH/USDT',
          duration: 300,
          amount: '72000',
        }),
      ],
    });
    h.seed('user-1', '100000.000000000000000000');
    const service = makeService(h);

    const first = service.placeTrade(
      'user-1',
      makeDto({ amount: '8000', clientRequestId: 'cr-l1' }) as never,
    );
    await waitFor(() => h.events.some((e) => e.startsWith('lock:')));

    const second = service.placeTrade(
      'user-1',
      makeDto({ amount: '8000', clientRequestId: 'cr-l2' }) as never,
    );

    await expect(first).resolves.toMatchObject({
      trade: { stake: '8000.000000000000000000' },
    });
    await expect(second).rejects.toThrow(/Utilization would exceed/);

    // Reserved exposure grew by exactly one placement only.
    expect(exposureSum(h.trades).toNumber()).toBe(80000);
  });

  it('risk rejection causes NO partial balance, fee or trade mutation', async () => {
    const h = makeHarness({
      trades: [
        makeTrade({ id: 'seed-risk', userId: 'user-1', amount: '14500' }),
      ],
    });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '1000', clientRequestId: 'cr-r' }) as never,
      ),
    ).rejects.toThrow(/User exposure would exceed/);

    expect(h.trades).toHaveLength(1); // only the seed remains
    expect(h.ledgers).toHaveLength(0); // no entry/fee/referral ledger rows
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1000.000000000000000000',
    );
    expect(h.locks.heldCount()).toBe(0);
  });

  it('liquidity rejection causes NO partial mutation', async () => {
    // Pool 100000, reserved 92000 -> available 8000. An 8000 TDX placement
    // projects reserved 100000/100000 = 100% > 80% -> rejected before any
    // mutation. (Also proves the total-exposure boundary: 92000+8000 = 100000
    // is exactly AT the total limit, hence not > and risk passes.)
    const h = makeHarness({
      poolValue: '100000.000000000000000000',
      trades: [
        makeTrade({
          id: 'seed-liq-full',
          userId: 'user-2',
          pair: 'ETH/USDT',
          duration: 300,
          amount: '92000',
        }),
      ],
    });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '8000', clientRequestId: 'cr-lf' }) as never,
      ),
    ).rejects.toThrow(/Utilization would exceed/);

    expect(h.trades).toHaveLength(1);
    expect(h.ledgers).toHaveLength(0);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1000.000000000000000000',
    );
    expect(h.locks.heldCount()).toBe(0);
  });

  it('releases the advisory lock after a successful placement', async () => {
    const h = makeHarness();
    h.seed('user-1', '5000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-ok' }) as never,
    );

    expect(h.events).toContain('lock:pulse-placement-risk');
    expect(h.locks.heldCount()).toBe(0);
  });

  it('releases the advisory lock after an exception/rollback', async () => {
    const h = makeHarness({ failLedgerSaveOnce: true });
    h.seed('user-1', '5000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-err' }) as never,
      ),
    ).rejects.toThrow('LEDGER_WRITE_FAILURE');

    expect(h.locks.heldCount()).toBe(0);
    // Rolled back: no trade, no ledger, balance untouched.
    expect(h.trades).toHaveLength(0);
    expect(h.ledgers).toHaveLength(0);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '5000.000000000000000000',
    );
  });

  it('normal placement: rich result, balance snapshot, entry+fee ledgers, pool routing, unchanged economics', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    const result = await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-n1' }) as never,
    );

    // Economics unchanged: 5% fee = 5, referral 2 / admin 2 / bonus 1.
    expect(result.trade.stake).toBe('100.000000000000000000');
    expect(result.trade.fee).toBe('5.000000000000000000');
    expect(result.trade.netStake).toBe('95.000000000000000000');
    expect(result.feeBreakdown).toMatchObject({
      totalFee: '5.000000000000000000',
      referral: '2.000000000000000000',
      admin: '2.000000000000000000',
      bonusVault: '1.000000000000000000',
    });
    expect(result.trade.status).toBe('OPEN');
    expect(result.trade.entryPrice).toBe('50000.000000000000000000');

    // Balance snapshot: gross-debit model (available -100, locked +100,
    // total unchanged).
    expect(result.balance).toEqual({
      available: '900.000000000000000000',
      locked: '100.000000000000000000',
      total: '1000.000000000000000000',
    });

    // Entry + fee ledger written; missing-referral fallback routed to pool.
    const types = h.ledgers.map((l) => (l as { type: string }).type);
    expect(types).toContain('TRADE_ENTRY');
    expect(types).toContain('TRADE_FEE');
    expect(h.poolValue()).toBe('1000002.000000000000000000');

    expect(h.locks.heldCount()).toBe(0);
  });

  it('clientRequestId replay returns the same trade without double debit', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    const dto = makeDto({ amount: '100', clientRequestId: 'cr-idem' });
    const first = await service.placeTrade('user-1', dto as never);
    const second = await service.placeTrade('user-1', dto as never);

    expect(second.trade.id).toBe(first.trade.id);
    expect(h.trades).toHaveLength(1);
    // Debited exactly once.
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
    expect(h.locks.heldCount()).toBe(0);
  });
});

describe('PulseTradeService — HIGH-2 placement financial atomicity', () => {
  const assertFullyRolledBack = (
    h: ReturnType<typeof makeHarness>,
    seededAvailable: string,
  ) => {
    expect(h.trades).toHaveLength(0); // no trade
    expect(h.ledgers).toHaveLength(0); // no entry/fee/referral legs
    expect(h.balances.get('user-1')?.availableBalance).toBe(seededAvailable);
    expect(h.poolValue()).toBe('1000000.000000000000000000'); // pool untouched
    expect(h.locks.heldCount()).toBe(0); // lock released on rollback
  };

  it('balance debit failure rolls back the entire placement atomically', async () => {
    const h = makeHarness({ failBalanceSaveOnce: true });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a1' }) as never,
      ),
    ).rejects.toThrow('BALANCE_SAVE_FAILURE');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('trade INSERT failure rolls back the balance debit', async () => {
    const h = makeHarness({ failTradeSaveOnce: true });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a2' }) as never,
      ),
    ).rejects.toThrow('TRADE_INSERT_FAILURE');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('entry fee ledger failure rolls back balance debit and trade', async () => {
    const h = makeHarness({ failLedgerSaveAtIndex: 0 });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a3' }) as never,
      ),
    ).rejects.toThrow('LEDGER_WRITE_FAILURE_AT_INDEX_0');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('fee allocation ledger failure rolls back all prior financial mutations', async () => {
    const h = makeHarness({ failLedgerSaveAtIndex: 1 });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a4' }) as never,
      ),
    ).rejects.toThrow('LEDGER_WRITE_FAILURE_AT_INDEX_1');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('referral fee leg failure rolls back entry, fee and trade', async () => {
    // Ledger order: 0 entry, 1 fee, 2..7 referral legs (L1..L6 pool-routed).
    const h = makeHarness({ failLedgerSaveAtIndex: 2 });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a5' }) as never,
      ),
    ).rejects.toThrow('LEDGER_WRITE_FAILURE_AT_INDEX_2');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('upline referral leg failure rolls back the upline balance credit too', async () => {
    // Upline chain: L1 -> up-1 (0.75% credit), L2..L6 -> pool. Ledger index 2
    // = L1 distribution entry, jo up-1 balance credit ke BAAD save hota hai.
    // Failure par up-1 ka credit bhi rollback hona chahiye.
    const h = makeHarness({
      failLedgerSaveAtIndex: 2,
      users: { 'user-1': 'up-1', 'up-1': null },
    });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a6' }) as never,
      ),
    ).rejects.toThrow('LEDGER_WRITE_FAILURE_AT_INDEX_2');

    assertFullyRolledBack(h, '1000.000000000000000000');
    // Upline row in-tx create hua tha — rollback ke baad exist nahi karta.
    expect(h.balances.has('up-1')).toBe(false);
  });

  it('pool persist failure rolls back the entire placement', async () => {
    const h = makeHarness({ failPoolSaveOnce: true });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-a7' }) as never,
      ),
    ).rejects.toThrow('POOL_PERSIST_FAILURE');

    assertFullyRolledBack(h, '1000.000000000000000000');
  });

  it('two concurrent same clientRequestId placements: exactly one trade, one debit, one fee set', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    const dto = makeDto({ amount: '100', clientRequestId: 'cr-same' });
    const first = service.placeTrade('user-1', dto as never);
    // Deterministic interleaving: doosri request tab launch karo jab pehli
    // tx ke andar hai (lock held) — pre-tx check (committed view) miss karegi,
    // phir in-tx idempotency re-check (lock ke andar) replay karegi.
    await waitFor(() => h.events.some((e) => e.startsWith('lock:')));
    const second = service.placeTrade('user-1', dto as never);

    const firstResult = await first;
    const secondResult = await second;

    expect(secondResult.trade.id).toBe(firstResult.trade.id);
    expect(h.trades).toHaveLength(1);
    // Exactly one set of financial mutations: entry + fee + 6 referral legs.
    expect(h.ledgers).toHaveLength(8);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
    expect(h.poolValue()).toBe('1000002.000000000000000000');
    expect(h.locks.heldCount()).toBe(0);
  });

  it('failed placement followed by retry with SAME clientRequestId succeeds cleanly', async () => {
    const h = makeHarness({ failTradeSaveOnce: true });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    const dto = makeDto({ amount: '100', clientRequestId: 'cr-retry' });
    await expect(service.placeTrade('user-1', dto as never)).rejects.toThrow(
      'TRADE_INSERT_FAILURE',
    );

    // Poora rollback: koi orphaned financial record nahi bacha.
    expect(h.trades).toHaveLength(0);
    expect(h.ledgers).toHaveLength(0);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '1000.000000000000000000',
    );
    expect(h.poolValue()).toBe('1000000.000000000000000000');

    // Retry ab normally create hota hai.
    await expect(service.placeTrade('user-1', dto as never)).resolves
      .toMatchObject({
        trade: { stake: '100.000000000000000000' },
      });
    expect(h.trades).toHaveLength(1);
    expect(h.ledgers).toHaveLength(8);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
    expect(h.locks.heldCount()).toBe(0);
  });

  it('successful placement with upline keeps the exact existing fee split', async () => {
    // L1 (0.75% = 0.75) -> up-1 balance; L2..L6 (1.25%) -> pool; total
    // referral 2% unchanged; admin 2% + bonus 1% allocation unchanged.
    const h = makeHarness({
      users: { 'user-1': 'up-1', 'up-1': null },
    });
    h.seed('user-1', '1000.000000000000000000');
    h.seed('up-1', '0.000000000000000000');
    const service = makeService(h);

    const result = await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-split' }) as never,
    );

    expect(result.feeBreakdown).toMatchObject({
      totalFee: '5.000000000000000000',
      referral: '2.000000000000000000',
      admin: '2.000000000000000000',
      bonusVault: '1.000000000000000000',
    });
    // Upline credit exact: 0.75% of 100.
    expect(h.balances.get('up-1')?.availableBalance).toBe(
      '0.750000000000000000',
    );
    // Pool routing exact: remaining 1.25 of the 2% referral.
    expect(h.poolValue()).toBe('1000001.250000000000000000');
    // Gross-debit semantics unchanged.
    expect(result.balance).toEqual({
      available: '900.000000000000000000',
      locked: '100.000000000000000000',
      total: '1000.000000000000000000',
    });
    expect(h.ledgers).toHaveLength(8); // entry + fee + 6 referral legs
    expect(h.locks.heldCount()).toBe(0);
  });
});

describe('PulseTradeService — HIGH-4 unallocated referral → liquidity idempotency', () => {
  const UNALLOCATED = 'TRADE_FEE_UNALLOCATED_TO_LIQUIDITY_POOL';
  const ALLOCATED = 'TRADE_FEE_DISTRIBUTION';

  const countLegs = (
    h: ReturnType<typeof makeHarness>,
    referenceType: string,
  ): number =>
    h.ledgers.filter((l) => l.referenceType === referenceType).length;

  it('normal unallocated routing: exactly one liquidity ledger leg per level', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-n1' }) as never,
    );

    expect(countLegs(h, UNALLOCATED)).toBe(6); // L1..L6 sab missing → pool
    const referenceIds = h.ledgers
      .filter((l) => l.referenceType === UNALLOCATED)
      .map((l) => l.referenceId);
    expect(new Set(referenceIds).size).toBe(6); // sab unique identities
    expect(countLegs(h, ALLOCATED)).toBe(0);
    expect(h.poolValue()).toBe('1000002.000000000000000000'); // +2% ek hi baar
  });

  it('replayed/colliding placement fails closed: no double pool credit', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-r1' }) as never,
    );
    h.armCollision(); // naya placement same trade id ke saath (replay simulation)

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h4-r2' }) as never,
      ),
    ).rejects.toThrow(/REFERRAL_UNALLOCATED_LEDGER_CONFLICT/);

    // Exactly-once: pool sirf pehli placement ka credit, koi double nahi.
    expect(h.poolValue()).toBe('1000002.000000000000000000');
    expect(countLegs(h, UNALLOCATED)).toBe(6);
    expect(h.ledgers).toHaveLength(8); // doosri placement ka kuch bhi persist nahi
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
    expect(h.trades).toHaveLength(1);
    expect(h.locks.heldCount()).toBe(0);
  });

  it('23505 backstop (pre-check race loss): typed conflict + full rollback, no double credit', async () => {
    // Pre-check race loss simulate: concurrent insert pre-check ko nahi
    // dikhta, par DB unique index INSERT ko reject karta hai.
    const h = makeHarness({ hideUnallocatedFromPreCheck: true });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-b1' }) as never,
    );
    h.armCollision();

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h4-b2' }) as never,
      ),
    ).rejects.toThrow(/REFERRAL_UNALLOCATED_LEDGER_CONFLICT/);

    // Transaction abort → poora rollback: pool/ledger/balance sab intact.
    expect(h.poolValue()).toBe('1000002.000000000000000000');
    expect(countLegs(h, UNALLOCATED)).toBe(6);
    expect(h.ledgers).toHaveLength(8);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
  });

  it('duplicate-key conflict for a DIFFERENT allocation is preserved (not swallowed)', async () => {
    const h = makeHarness({
      failLedger23505WithConstraint:
        'IDX_ledger_trade_fee_distribution_reference_unique',
    });
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h4-d1' }) as never,
      ),
    ).rejects.toThrow(/IDX_ledger_trade_fee_distribution_reference_unique/);

    // Raw integrity error convert nahi hua — rollback ke baad retry (naya
    // trade) normally succeed karta hai.
    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h4-d2' }) as never,
      ),
    ).resolves.toBeTruthy();
    expect(h.poolValue()).toBe('1000002.000000000000000000');
  });

  it('two different trades get two legitimate independent ledger leg sets', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-t1' }) as never,
    );
    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-t2' }) as never,
    );

    expect(h.trades).toHaveLength(2);
    expect(countLegs(h, UNALLOCATED)).toBe(12); // har trade ki apni 6 legs
    expect(h.poolValue()).toBe('1000004.000000000000000000'); // 2 + 2
  });

  it('partial referral tree: allocated leg unchanged, missing levels route exactly once, sum reconciles', async () => {
    const h = makeHarness({
      users: { 'user-1': 'up-1', 'up-1': null },
    });
    h.seed('user-1', '1000.000000000000000000');
    h.seed('up-1', '0.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h4-p1' }) as never,
    );

    // L1 allocated upline ko (unchanged behavior), L2..L6 pool ko.
    expect(countLegs(h, ALLOCATED)).toBe(1);
    expect(countLegs(h, UNALLOCATED)).toBe(5);
    expect(h.balances.get('up-1')?.availableBalance).toBe(
      '0.750000000000000000',
    );
    expect(h.poolValue()).toBe('1000001.250000000000000000');

    // Reconciliation invariant: allocated + unallocated = referral fee (2%).
    const allocatedSum = h.ledgers
      .filter((l) => l.referenceType === ALLOCATED)
      .reduce((acc, l) => acc.plus(l.amount as string), new Decimal(0));
    const unallocatedSum = h.ledgers
      .filter((l) => l.referenceType === UNALLOCATED)
      .reduce((acc, l) => acc.plus(l.amount as string), new Decimal(0));
    expect(allocatedSum.plus(unallocatedSum).toFixed(18)).toBe(
      '2.000000000000000000',
    );
    expect(h.locks.heldCount()).toBe(0);
  });
});

describe('PulseTradeService — HIGH-5 client request replay integrity', () => {
  const UNALLOCATED = 'TRADE_FEE_UNALLOCATED_TO_LIQUIDITY_POOL';
  const ENTRY = 'pulse_trade';
  const FEE_ALLOCATION = 'TRADE_FEE_ALLOCATION';

  const findLegIndex = (
    h: ReturnType<typeof makeHarness>,
    referenceType: string,
    referenceId: string,
  ): number =>
    h.ledgers.findIndex(
      (l) =>
        l.referenceType === referenceType && l.referenceId === referenceId,
    );

  it('complete placement replay is financially verified and mutation-free', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    const first = await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-1' }) as never,
    );

    const snapshot = {
      ledgers: h.ledgers.length,
      pool: h.poolValue(),
      available: h.balances.get('user-1')?.availableBalance,
      trades: h.trades.length,
    };

    const replay = await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-1' }) as never,
    );

    expect(replay.trade.id).toBe(first.trade.id);
    // Zero financial mutation on replay.
    expect(h.ledgers).toHaveLength(snapshot.ledgers);
    expect(h.poolValue()).toBe(snapshot.pool);
    expect(h.balances.get('user-1')?.availableBalance).toBe(snapshot.available);
    expect(h.trades).toHaveLength(snapshot.trades);
  });

  it('missing entry debit ledger → replay rejected INCOMPLETE, no mutation', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-2' }) as never,
    );
    // Legacy/partial state simulate: entry ledger row remove.
    const idx = findLegIndex(h, ENTRY, 'pulse-new-1');
    expect(idx).toBeGreaterThanOrEqual(0);
    h.ledgers.splice(idx, 1);
    const mutatedLedgers = h.ledgers.length;

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-2' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCOMPLETE/);

    // Fail-closed: koi auto-repair, koi naya mutation nahi.
    expect(h.ledgers).toHaveLength(mutatedLedgers);
    expect(h.poolValue()).toBe('1000002.000000000000000000');
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
    expect(h.trades).toHaveLength(1);
  });

  it('missing referral leg → replay rejected INCOMPLETE, no mutation', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-3' }) as never,
    );
    // Ek unallocated referral leg remove karo (legacy partial state).
    const legIdx = h.ledgers.findIndex(
      (l) => l.referenceType === UNALLOCATED,
    );
    expect(legIdx).toBeGreaterThanOrEqual(0);
    h.ledgers.splice(legIdx, 1);

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-3' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCOMPLETE/);

    expect(h.ledgers.filter((l) => l.referenceType === UNALLOCATED)).toHaveLength(5);
    expect(h.poolValue()).toBe('1000002.000000000000000000');
    expect(h.trades).toHaveLength(1);
  });

  it('missing pool-routing record → replay rejected INCOMPLETE, no mutation', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-4' }) as never,
    );
    // Pool setting record gayab (legacy state).
    h.poolSetting.key = 'REMOVED_POOL';

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-4' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCOMPLETE/);

    expect(h.trades).toHaveLength(1);
    expect(h.balances.get('user-1')?.availableBalance).toBe(
      '900.000000000000000000',
    );
  });

  it('incorrect fee amount on fee allocation ledger → INCONSISTENT', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-5' }) as never,
    );
    const feeIdx = findLegIndex(h, FEE_ALLOCATION, 'pulse-new-1');
    expect(feeIdx).toBeGreaterThanOrEqual(0);
    h.ledgers[feeIdx].amount = '4.000000000000000000'; // 5% nahi

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-5' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCONSISTENT/);

    expect(h.trades).toHaveLength(1);
  });

  it('incorrect gross amount on entry ledger → INCONSISTENT', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-6' }) as never,
    );
    const entryIdx = findLegIndex(h, ENTRY, 'pulse-new-1');
    h.ledgers[entryIdx].amount = '99.000000000000000000'; // gross mismatch

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-6' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCONSISTENT/);

    expect(h.trades).toHaveLength(1);
  });

  it('duplicate fee allocation leg → INCONSISTENT', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-7' }) as never,
    );
    const feeIdx = findLegIndex(h, FEE_ALLOCATION, 'pulse-new-1');
    // Duplicate row (nayi id, same business identity).
    h.ledgers.push({
      ...h.ledgers[feeIdx],
      id: `l-dup-${h.ledgers.length + 1}`,
    });

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-7' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCONSISTENT/);

    expect(h.trades).toHaveLength(1);
  });

  it('balance debit disagreement (lock mismatch) → INCONSISTENT', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    const service = makeService(h);

    await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-h5-8' }) as never,
    );
    // Debit/lock state trade ke saath agree nahi karta (manual tampering).
    const balance = h.balances.get('user-1');
    balance!.lockedBalance = '0.000000000000000000';
    balance!.tradingLocked = '0.000000000000000000';

    await expect(
      service.placeTrade(
        'user-1',
        makeDto({ amount: '100', clientRequestId: 'cr-h5-8' }) as never,
      ),
    ).rejects.toThrow(/PLACEMENT_REPLAY_INCONSISTENT/);

    expect(h.trades).toHaveLength(1);
  });

  it('ownership isolation: same clientRequestId across users never replays another user trade', async () => {
    const h = makeHarness();
    h.seed('user-1', '1000.000000000000000000');
    h.seed('user-2', '1000.000000000000000000');
    const service = makeService(h);

    const first = await service.placeTrade(
      'user-1',
      makeDto({ amount: '100', clientRequestId: 'cr-shared' }) as never,
    );
    const second = await service.placeTrade(
      'user-2',
      makeDto({ amount: '100', clientRequestId: 'cr-shared' }) as never,
    );

    // Dono users ki apni alag trades — cross-user replay/reveal nahi.
    expect(second.trade.id).not.toBe(first.trade.id);
    expect(h.trades).toHaveLength(2);
    expect(h.ledgers).toHaveLength(16); // dono placements ke apne legs
    expect(h.poolValue()).toBe('1000004.000000000000000000');
  });
});

