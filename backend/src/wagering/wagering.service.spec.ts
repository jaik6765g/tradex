import { ForbiddenException } from '@nestjs/common';
import Decimal from 'decimal.js';

import { AdminAccessPolicy } from '../auth/admin-access.policy';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { Deposit } from '../deposits/deposit.entity';
import { LedgerEntry } from '../ledger/ledger.entity';

import { WageringObligation, WageringObligationStatus } from './entities/wagering-obligation.entity';
import {
  WageringActivityType,
  WageringEvent,
  WageringEventStatus,
} from './entities/wagering-event.entity';
import { WageringNotification } from './entities/wagering-notification.entity';
import { WageringSettings } from './entities/wagering-settings.entity';
import { WageringUserOverride } from './entities/wagering-user-override.entity';
import { LottoTicket } from '../modules/lotto/entities/lotto-ticket.entity';
import { Trade } from '../pulse-trade/entities/trade.entity';
import { CreateWageringSystem1788000000000 } from '../migrations/1788000000000-CreateWageringSystem';
import {
  LOTTO_SOURCE_TYPE,
  SURPLUS_REJECT_REASON,
  TRADE_SOURCE_TYPE,
  WageringService,
  netStakeAfterFees,
} from './wagering.service';
import { WageringAdminController } from './wagering-admin.controller';

const TDX_18 = '000000000000000000';
const USER = '11111111-1111-1111-1111-111111111111';
const ADMIN = '22222222-2222-2222-2222-222222222222';

interface Harness {
  service: WageringService;
  settings: Record<string, unknown>;
  settingsRepo: any;
  overrideRepo: any;
  obligationRepo: any;
  eventRepo: any;
  notificationRepo: any;
  auditRepo: any;
  depositRepo: any;
  ledgerRepo: any;
  lottoTicketRepo: any;
  tradeRepo: any;
  depositCandidates: Deposit[];
}

function makeQb(rows: unknown[]) {
  const state: {
    whereParams: Record<string, unknown>;
    setValues: Record<string, unknown>;
    entity: unknown;
  } = { whereParams: {}, setValues: {}, entity: null };

  const qb: Record<string, unknown> = {};
  const self = qb as never;

  qb.update = (entity: unknown) => {
    state.entity = entity;
    return self;
  };
  qb.set = (values: Record<string, unknown>) => {
    state.setValues = values;
    return self;
  };
  qb.where = (_cond: unknown, params?: Record<string, unknown>) => {
    state.whereParams = { ...state.whereParams, ...(params ?? {}) };
    return self;
  };
  qb.andWhere = (_cond: unknown, params?: Record<string, unknown>) => {
    state.whereParams = { ...state.whereParams, ...(params ?? {}) };
    return self;
  };
  qb.orderBy = () => self;
  qb.addOrderBy = () => self;
  qb.skip = () => self;
  qb.take = () => self;
  qb.setLock = () => self;
  qb.execute = async () => {
    // Reproduces the expire-first semantics of recordWageredVolume.
    for (const row of rows as Array<Record<string, unknown>>) {
      const expiresAt = row.expiresAt as Date | null;
      if (
        row.userId === state.whereParams.userId &&
        row.status === 'ACTIVE' &&
        expiresAt &&
        expiresAt < (state.whereParams.now as Date)
      ) {
        Object.assign(row, state.setValues);
      }
    }
  };
  qb.getMany = async () => {
    const params = state.whereParams as Record<string, unknown>;
    let out = (rows as Array<Record<string, unknown>>).slice();
    if (typeof params.userId === 'string') {
      out = out.filter((r) => r.userId === params.userId);
    }
    if (typeof params.status === 'string') {
      out = out.filter((r) => r.status === params.status);
    }
    const since = params.since;
    if (since instanceof Date) {
      out = out.filter(
        (r) => r.creditedAt instanceof Date && r.creditedAt >= since,
      );
    }
    const cutoff = params.cutoff;
    if (cutoff instanceof Date) {
      out = out.filter(
        (r) => r.creditedAt instanceof Date && r.creditedAt >= cutoff,
      );
    }
    // FIFO ordering (createdAt ASC, id ASC) — mirrors the real ORDER BY.
    return out.sort(
      (a, b) =>
        ((a.createdAt as Date)?.getTime() ?? 0) -
          ((b.createdAt as Date)?.getTime() ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    ) as never;
  };
  qb.getManyAndCount = async () => [rows, rows.length] as never;
  return qb;
}

function makeListRepo(rows: unknown[]) {
  const repo: Record<string, unknown> = {};
  let gen = 0;
  repo.items = rows;
  repo.create = (x: Record<string, unknown> = {}) => ({
    id: x.id ?? `gen-${(++gen).toString(36)}`,
    ...x,
  });
  repo.save = async (x: Record<string, unknown>) => {
    const idx = (rows as Array<Record<string, unknown>>).findIndex(
      (r) => r.id !== undefined && r.id === x.id,
    );
    if (idx >= 0) {
      rows[idx] = { ...(rows[idx] as Record<string, unknown>), ...x };
    } else {
      rows.push(x);
    }
    return x as never;
  };
  repo.remove = async (x: Record<string, unknown>) => {
    const idx = (rows as Array<Record<string, unknown>>).findIndex(
      (r) => r.id === x.id,
    );
    if (idx >= 0) rows.splice(idx, 1);
    return x as never;
  };
  repo.find = async (opts: { where?: Record<string, unknown> } = {}) =>
    (rows as Array<Record<string, unknown>>).filter((r) =>
      Object.entries(opts.where ?? {}).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v,
      ),
    ) as never;
  repo.findOne = async (opts: {
    where?: Record<string, unknown>;
  } = {}) =>
    ((rows as Array<Record<string, unknown>>).find((r) =>
      Object.entries(opts.where ?? {}).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v,
      ),
    ) ?? null) as never;
  repo.update = async (
    where: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) => {
    for (const row of rows as Array<Record<string, unknown>>) {
      if (
        Object.entries(where).every(
          ([k, v]) => (row as Record<string, unknown>)[k] === v,
        )
      ) {
        Object.assign(row, patch);
      }
    }
  };
  repo.createQueryBuilder = () => makeQb(rows);
  return repo;
}

function makeHarness(
  settingsOverrides: Record<string, unknown> = {},
): Harness {
  const settings = {
    singletonKey: 1,
    wageringEnabled: true,
    defaultMultiplier: 2,
    allowedMultipliers: [1, 2, 3, 5, 10],
    eligibleActivity: 'BOTH',
    withdrawalEnforcement: true,
    notifyUsers: false,
    expiryDays: 0,
    reconciliationMaxAgeDays: 30,
    activationTimestamp: new Date('2026-01-01T00:00:00Z'),
    policyVersion: 1,
    ...settingsOverrides,
  };

  const settingsRepo = makeListRepo([settings]);
  const overrideRepo = makeListRepo([]);
  const obligationRepo = makeListRepo([]);
  const eventRepo = makeListRepo([]);
  const notificationRepo = makeListRepo([]);
  const auditRepo = makeListRepo([]);
  const ledgerRepo = makeListRepo([]);
  const lottoTicketRepo = makeListRepo([]);
  const tradeRepo = makeListRepo([]);

  // Event-reconciliation QB: mirrors the service's ledger scan filters
  // (wagering source types, referenceType set, safety window, age window).
  ledgerRepo.createQueryBuilder = () => {
    const state: {
      types: string[];
      safetyCutoff?: Date;
      maxAge?: Date;
    } = { types: [] };
    const source = ledgerRepo.items as Array<Record<string, unknown>>;
    const qb: Record<string, unknown> = {};
    const self = qb as never;
    qb.where = (_c: unknown, params?: Record<string, unknown>) => {
      state.types = (params?.types as string[]) ?? [];
      return self;
    };
    qb.andWhere = (
      _c: unknown,
      params?: Record<string, unknown>,
    ) => {
      if (params?.safetyCutoff instanceof Date) {
        state.safetyCutoff = params.safetyCutoff;
      }
      if (params?.maxAge instanceof Date) {
        state.maxAge = params.maxAge;
      }
      return self;
    };
    qb.orderBy = () => self;
    qb.addOrderBy = () => self;
    qb.take = () => self;
    qb.getMany = async () =>
      source
        .filter((r) => {
          if (!state.types.includes(String(r.type))) return false;
          const rt = String(r.referenceType);
          if (rt !== 'LOTTO_TICKET' && rt !== 'pulse_trade') return false;
          const createdAt = r.createdAt as Date | undefined;
          if (!(createdAt instanceof Date)) return false;
          if (state.safetyCutoff && createdAt >= state.safetyCutoff) {
            return false;
          }
          if (state.maxAge && createdAt < state.maxAge) return false;
          return true;
        })
        .sort(
          (a, b) =>
            ((a.createdAt as Date)?.getTime() ?? 0) -
              ((b.createdAt as Date)?.getTime() ?? 0) ||
            String(a.id).localeCompare(String(b.id)),
        ) as never;
    return qb;
  };

  const depositCandidates: Deposit[] = [];
  const depositRepo = makeListRepo(depositCandidates);

  const entityRepoMap = new Map<unknown, unknown>([
    [WageringSettings, settingsRepo],
    [WageringUserOverride, overrideRepo],
    [WageringObligation as unknown, obligationRepo],
    [WageringEvent, eventRepo],
    [WageringNotification, notificationRepo],
    [AdminAuditLog, auditRepo],
    [Deposit, depositRepo],
    [LedgerEntry, ledgerRepo],
    [LottoTicket, lottoTicketRepo],
    [Trade, tradeRepo],
  ]);

  // Serialized transactions — emulates DB locking/serialisation for the
  // concurrency tests (same technique as the lotto cutoff-timing spec).
  let txChain = Promise.resolve();
  const fakeManager = {
    getRepository: (entity: unknown) => entityRepoMap.get(entity),
  };
  const makeTransaction = () =>
    (cb: (m: unknown) => unknown): Promise<unknown> => {
      const previous = txChain;
      const result = previous.then(() => cb(fakeManager));
      txChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };

  for (const repo of [
    settingsRepo,
    overrideRepo,
    obligationRepo,
    eventRepo,
    notificationRepo,
    auditRepo,
  ]) {
    repo.manager = {
      transaction: makeTransaction(),
      getRepository: fakeManager.getRepository,
    };
  }

  const service = new WageringService(
    settingsRepo as never,
    overrideRepo as never,
    obligationRepo as never,
    eventRepo as never,
    notificationRepo as never,
    auditRepo as never,
    depositRepo as never,
    ledgerRepo as never,
    lottoTicketRepo as never,
    tradeRepo as never,
  );

  return {
    service,
    settings,
    settingsRepo,
    overrideRepo,
    obligationRepo,
    eventRepo,
    notificationRepo,
    auditRepo,
    depositRepo,
    ledgerRepo,
    lottoTicketRepo,
    tradeRepo,
    depositCandidates,
  };
}

function makeDeposit(overrides: Partial<Record<string, unknown>> = {}): Deposit {
  // Recent credit time: inside both the activation timestamp and the default
  // 30-day reconciliation window (production reconciliation semantics).
  const now = new Date();
  return {
    id: `d-${Math.random().toString(36).slice(2, 8)}`,
    userId: USER,
    status: 'COMPLETED',
    creditedAt: now,
    usdtAmount: `100.${TDX_18}`,
    tdxAmount: `10000.${TDX_18}`,
    ...overrides,
  } as unknown as Deposit;
}

function makeObligation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const createdAt = (overrides.createdAt as Date) ?? new Date();
  return {
    id: `ob-${Math.random().toString(36).slice(2, 8)}`,
    userId: USER,
    depositId: `dep-${Math.random().toString(36).slice(2, 8)}`,
    ledgerEntryId: 'le-1',
    sourceUsdtAmount: `100.${TDX_18}`,
    sourceTdxAmount: `10000.${TDX_18}`,
    conversionRate: `100.${TDX_18}`,
    depositAmountTdx: `10000.${TDX_18}`,
    multiplier: 2,
    requiredAmount: `20000.${TDX_18}`,
    completedAmount: `0.${TDX_18}`,
    status: WageringObligationStatus.ACTIVE,
    policyVersion: 1,
    eligibleActivity: 'BOTH',
    expiresAt: null,
    createdAt,
    ...overrides,
  };
}

describe('WageringService — obligation calculations (1X / 2X / override / fallback)', () => {
  it('creates a 1X obligation with exact decimal arithmetic', async () => {
    const h = makeHarness({ defaultMultiplier: 1 });
    const created = await h.service.createObligationForDeposit(
      makeDeposit(),
      'le-1',
    );

    expect(created).toBe(true);
    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.multiplier).toBe(1);
    expect(ob.requiredAmount).toBe(`10000.${TDX_18}`);
    expect(ob.depositAmountTdx).toBe(`10000.${TDX_18}`);
    expect(ob.completedAmount).toBe(`0.${TDX_18}`);
    expect(ob.status).toBe(WageringObligationStatus.ACTIVE);
  });

  it('creates a 2X obligation (required = 2 x deposited TDX)', async () => {
    const h = makeHarness({ defaultMultiplier: 2 });
    await h.service.createObligationForDeposit(makeDeposit(), 'le-1');

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.multiplier).toBe(2);
    expect(ob.requiredAmount).toBe(`20000.${TDX_18}`);
    // Conversion-rate snapshot = tdx / usdt = exactly 100.
    expect(ob.conversionRate).toBe(`100.${TDX_18}`);
  });

  it('uses the user override over the global default and snapshots it', async () => {
    const h = makeHarness({ defaultMultiplier: 2 });
    await h.service.setOverride(ADMIN, USER, 5, 'VIP arrangement Q1');
    await h.service.createObligationForDeposit(makeDeposit(), 'le-1');

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.multiplier).toBe(5);
    expect(ob.requiredAmount).toBe(`50000.${TDX_18}`);
  });

  it('falls back to the global default when no override exists', async () => {
    const h = makeHarness({ defaultMultiplier: 3 });
    const effective = await h.service.resolveEffectiveMultiplier(USER);
    expect(effective).toEqual({ multiplier: 3, source: 'GLOBAL_DEFAULT' });
  });

  it('reports USER_OVERRIDE as multiplier source when an override exists', async () => {
    const h = makeHarness();
    await h.service.setOverride(ADMIN, USER, 10, 'Top user custom rate');
    const effective = await h.service.resolveEffectiveMultiplier(USER);
    expect(effective.source).toBe('USER_OVERRIDE');
    expect(effective.multiplier).toBe(10);
  });
});

describe('WageringService — multiplier snapshot immutability', () => {
  it('never recalculates an existing obligation after override/settings change', async () => {
    const h = makeHarness({ defaultMultiplier: 2 });
    await h.service.createObligationForDeposit(makeDeposit(), 'le-1');
    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    const snapshot = {
      multiplier: ob.multiplier,
      requiredAmount: ob.requiredAmount,
      policyVersion: ob.policyVersion,
    };

    // Later global + user changes happen.
    await h.service.setOverride(ADMIN, USER, 10, 'Escalated per compliance');
    await h.service.updateSettings(ADMIN, {
      defaultMultiplier: 5,
      reason: 'Promotion change for new deposits',
    });

    expect(ob.multiplier).toBe(snapshot.multiplier);
    expect(ob.requiredAmount).toBe(snapshot.requiredAmount);
    expect(ob.policyVersion).toBe(snapshot.policyVersion);
    // New obligations pick up the changed config.
    expect(h.settings.policyVersion).toBe(2);
    expect(
      (await h.service.resolveEffectiveMultiplier(USER)).multiplier,
    ).toBe(10);
  });
});

describe('WageringService — duplicate protection', () => {
  it('creates exactly one obligation per deposit (duplicate deposit protection)', async () => {
    const h = makeHarness();
    const deposit = makeDeposit();

    expect(
      await h.service.createObligationForDeposit(deposit, 'le-1'),
    ).toBe(true);
    expect(
      await h.service.createObligationForDeposit(deposit, 'le-1'),
    ).toBe(true);
    expect(h.obligationRepo.items.length).toBe(1);
  });

  it('counts a wagering event exactly once (duplicate event protection)', async () => {
    const h = makeHarness();
    await h.service.createObligationForDeposit(makeDeposit(), 'le-1');

    const first = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: '9001',
      amount: `5000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });
    expect(first.status).toBe('COUNTED');

    const duplicate = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: '9001',
      amount: `5000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });
    expect(duplicate.status).toBe('ALREADY_COUNTED');

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.completedAmount).toBe(`5000.${TDX_18}`);
    expect(ob.status).toBe(WageringObligationStatus.ACTIVE);
    expect(h.eventRepo.items.length).toBe(1);
  });
});

describe('WageringService — deterministic FIFO allocation', () => {
  it('allocates across multiple ACTIVE obligations oldest-first with exact legs', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({ createdAt: new Date('2026-01-02T00:00:00Z') }),
      makeObligation({
        id: 'ob-second',
        createdAt: new Date('2026-01-03T00:00:00Z'),
      }),
    );

    const result = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.TRADE,
      sourceType: TRADE_SOURCE_TYPE,
      sourceId: 't-1',
      amount: `25000.${TDX_18}`,
      ledgerType: 'TRADE_ENTRY',
      settlementOutcome: 'SETTLED',
    });
    expect(result.status).toBe('COUNTED');

    const events = h.eventRepo.items as Array<Record<string, unknown>>;
    expect(events.length).toBe(2);
    expect(events[0].obligationId).toBe(
      (h.obligationRepo.items[0] as Record<string, unknown>).id,
    );
    expect(events[0].allocatedAmount).toBe(`20000.${TDX_18}`);
    expect(events[0].legIndex).toBe(0);
    expect(events[1].obligationId).toBe('ob-second');
    expect(events[1].allocatedAmount).toBe(`5000.${TDX_18}`);
    expect(events[1].legIndex).toBe(1);

    const first = h.obligationRepo.items[0] as Record<string, unknown>;
    const second = h.obligationRepo.items[1] as Record<string, unknown>;
    expect(first.status).toBe(WageringObligationStatus.COMPLETED);
    expect(first.completedAmount).toBe(`20000.${TDX_18}`);
    expect(second.status).toBe(WageringObligationStatus.ACTIVE);
    expect(second.completedAmount).toBe(`5000.${TDX_18}`);
  });

  it('records a REJECTED surplus row when wagering exceeds all obligations', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: '9002',
      amount: `30000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    const events = h.eventRepo.items as Array<Record<string, unknown>>;
    const surplus = events.find(
      (e) => e.status === WageringEventStatus.REJECTED,
    );
    expect(surplus).toBeDefined();
    expect(surplus?.rejectReason).toBe(SURPLUS_REJECT_REASON);
    expect(surplus?.allocatedAmount).toBe(`0.${TDX_18}`);

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.completedAmount).toBe(`20000.${TDX_18}`);
    expect(ob.status).toBe(WageringObligationStatus.COMPLETED);
  });

  it('never double-counts concurrent settlements of the same source', async () => {
    const h = makeHarness();
    await h.service.createObligationForDeposit(makeDeposit(), 'le-1');

    const input = {
      userId: USER,
      activityType: WageringActivityType.TRADE,
      sourceType: TRADE_SOURCE_TYPE,
      sourceId: 't-race',
      amount: `10000.${TDX_18}`,
      ledgerType: 'TRADE_ENTRY',
      settlementOutcome: 'SETTLED' as const,
    };
    // Transactions are serialized in the harness (as FOR UPDATE is in PG).
    const results = await Promise.all([
      h.service.recordWageredVolume(input),
      h.service.recordWageredVolume(input),
    ]);

    expect(results.filter((r) => r.status === 'COUNTED').length).toBe(1);
    expect(results.filter((r) => r.status === 'ALREADY_COUNTED').length).toBe(1);

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.completedAmount).toBe(`10000.${TDX_18}`);
  });

  it('serializes concurrent settlements of different sources exactly', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({ requiredAmount: `15000.${TDX_18}` }),
    );

    await Promise.all([
      h.service.recordWageredVolume({
        userId: USER,
        activityType: WageringActivityType.LOTTO,
        sourceType: LOTTO_SOURCE_TYPE,
        sourceId: '9003',
        amount: `10000.${TDX_18}`,
        ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
      }),
      h.service.recordWageredVolume({
        userId: USER,
        activityType: WageringActivityType.TRADE,
        sourceType: TRADE_SOURCE_TYPE,
        sourceId: 't-4',
        amount: `10000.${TDX_18}`,
        ledgerType: 'TRADE_ENTRY',
      settlementOutcome: 'SETTLED',
      }),
    ]);

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.completedAmount).toBe(`15000.${TDX_18}`);
    expect(ob.status).toBe(WageringObligationStatus.COMPLETED);

    // Exactly one COUNTED leg per settlement source (2), plus the required
    // REJECTED surplus row for the genuinely unallocated 5000.
    const events = h.eventRepo.items as Array<Record<string, unknown>>;
    const counted = events.filter(
      (e) => e.status === WageringEventStatus.COUNTED,
    );
    expect(counted.length).toBe(2);
    const surplus = events.filter(
      (e) => e.status === WageringEventStatus.REJECTED,
    );
    expect(surplus.length).toBe(1);
    expect(surplus[0].allocatedAmount).toBe(`0.${TDX_18}`);
    expect(surplus[0].sourceId).toBe('t-4');
    // Total allocated volume equals the obligation's cap exactly.
    const allocated = counted.reduce(
      (sum, e) => sum.plus(String(e.allocatedAmount)),
      new Decimal(0),
    );
    expect(allocated.toFixed(18)).toBe(`15000.${TDX_18}`);
  });
});

describe('WageringService — withdrawal enforcement', () => {
  it('rejects a withdrawal when remaining wagering is incomplete', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    await expect(h.service.assertWithdrawalAllowed(USER)).rejects.toMatchObject({
      response: {
        code: 'WAGERING_REQUIREMENT_INCOMPLETE',
        remainingWagering: `20000.${TDX_18}`,
      },
    });
    // Zero mutation: no event, no obligation change.
    expect(h.eventRepo.items.length).toBe(0);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`0.${TDX_18}`);
  });

  it('accepts a withdrawal when obligations are completed', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({
        completedAmount: `20000.${TDX_18}`,
        status: WageringObligationStatus.COMPLETED,
      }),
    );

    const result = await h.service.assertWithdrawalAllowed(USER);
    expect(result.allowed).toBe(true);
    expect(result.remainingWagering).toBe('0');
  });

  it('allows withdrawals when enforcement is disabled', async () => {
    const h = makeHarness({ withdrawalEnforcement: false });
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.assertWithdrawalAllowed(USER);
    expect(result.allowed).toBe(true);
  });

  it('allows withdrawals when wagering is disabled entirely', async () => {
    const h = makeHarness({ wageringEnabled: false });
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.assertWithdrawalAllowed(USER);
    expect(result.allowed).toBe(true);
  });

  it('surfaces a ForbiddenException type for blocked withdrawals', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    await expect(
      h.service.assertWithdrawalAllowed(USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('WageringService — eligibility gating', () => {
  it('does not count volume for a non-eligible activity type', async () => {
    const h = makeHarness({ eligibleActivity: 'LOTTO' });
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.TRADE,
      sourceType: TRADE_SOURCE_TYPE,
      sourceId: 't-9',
      amount: `1000.${TDX_18}`,
      ledgerType: 'TRADE_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    expect(result.status).toBe('NO_OBLIGATIONS');
    expect(
      (h.eventRepo.items as Array<Record<string, unknown>>).filter(
        (e) => e.status === WageringEventStatus.COUNTED,
      ).length,
    ).toBe(0);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`0.${TDX_18}`);
  });

  it('does not count LOTTO volume when only TRADE is eligible', async () => {
    const h = makeHarness({ eligibleActivity: 'TRADE' });
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: '9009',
      amount: `1000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    expect(result.status).toBe('NO_OBLIGATIONS');
    expect(h.eventRepo.items.length).toBe(0);
  });

  it('counts both activity types when eligible activity is BOTH', async () => {
    const h = makeHarness({ eligibleActivity: 'BOTH' });
    h.obligationRepo.items.push(makeObligation());

    const lotto = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: '9010',
      amount: `500.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });
    const trade = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.TRADE,
      sourceType: TRADE_SOURCE_TYPE,
      sourceId: 't-10',
      amount: `500.${TDX_18}`,
      ledgerType: 'TRADE_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    expect(lotto.status).toBe('COUNTED');
    expect(trade.status).toBe('COUNTED');
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`1000.${TDX_18}`);
  });

  it('does not create obligations when wagering is disabled', async () => {
    const h = makeHarness({ wageringEnabled: false });
    const created = await h.service.createObligationForDeposit(
      makeDeposit(),
      'le-1',
    );
    expect(created).toBe(false);
    expect(h.obligationRepo.items.length).toBe(0);
  });

  it('does not create obligations for deposits credited before activation', async () => {
    const h = makeHarness();
    const created = await h.service.createObligationForDeposit(
      makeDeposit({ creditedAt: new Date('2025-12-01T00:00:00Z') }),
      'le-1',
    );
    expect(created).toBe(false);
    expect(h.obligationRepo.items.length).toBe(0);
  });
});

describe('WageringService — deposit-obligation reconciliation', () => {
  it('creates obligations for qualifying deposits and is idempotent', async () => {
    const h = makeHarness();
    const deposit = makeDeposit();
    h.depositCandidates.push(deposit);
    h.ledgerRepo.items.push({
      id: 'le-1',
      referenceId: deposit.id,
      referenceType: 'deposit',
      type: 'DEPOSIT',
    });

    const first = await h.service.reconcileDepositObligations(ADMIN);
    expect(first.created).toBe(1);
    const second = await h.service.reconcileDepositObligations(ADMIN);
    expect(second.created).toBe(0);
    expect(h.obligationRepo.items.length).toBe(1);

    const runs = h.auditRepo.items as Array<Record<string, unknown>>;
    expect(
      runs.filter((r) => r.action === 'WAGERING_RECONCILE_RUN').length,
    ).toBe(2);
  });

  it('skips deposits without a credited ledger entry', async () => {
    const h = makeHarness();
    h.depositCandidates.push(makeDeposit());

    const result = await h.service.reconcileDepositObligations(ADMIN);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('WageringService — audit and safeguards', () => {
  it('audits every override change with previous value and reason', async () => {
    const h = makeHarness();
    await h.service.setOverride(ADMIN, USER, 3, 'Compliance review 2026-02');
    await h.service.setOverride(ADMIN, USER, 5, 'Second adjustment');

    const overrides = h.overrideRepo.items as Array<Record<string, unknown>>;
    expect(overrides.length).toBe(1);
    expect(overrides[0].previousValue).toBe(3);
    expect(overrides[0].reason).toBe('Second adjustment');

    const audits = h.auditRepo.items as Array<Record<string, unknown>>;
    const overrideAudits = audits.filter(
      (a) => a.action === 'WAGERING_OVERRIDE_SET',
    );
    expect(overrideAudits.length).toBe(2);
    expect(overrideAudits[0].oldValue).toBeNull();
    expect(overrideAudits[1].oldValue).toEqual({ multiplier: 3 });
    expect((overrideAudits[1].newValue as Record<string, unknown>).reason).toBe(
      'Second adjustment',
    );
  });

  it('rejects override multipliers outside the allowlist', async () => {
    const h = makeHarness();
    await expect(
      h.service.setOverride(ADMIN, USER, 7, 'Arbitrary multiplier attempt'),
    ).rejects.toBeDefined();
    expect(h.overrideRepo.items.length).toBe(0);
  });

  it('removes an override with audit and falls back to the global default', async () => {
    const h = makeHarness({ defaultMultiplier: 2 });
    await h.service.setOverride(ADMIN, USER, 5, 'Temporary VIP rate');
    await h.service.removeOverride(ADMIN, USER, 'VIP period ended');

    expect(h.overrideRepo.items.length).toBe(0);
    const audits = h.auditRepo.items as Array<Record<string, unknown>>;
    expect(audits.some((a) => a.action === 'WAGERING_OVERRIDE_REMOVE')).toBe(
      true,
    );
    expect(
      (await h.service.resolveEffectiveMultiplier(USER)).source,
    ).toBe('GLOBAL_DEFAULT');
  });

  it('audits settings updates with a policy version bump', async () => {
    const h = makeHarness();
    await h.service.updateSettings(ADMIN, {
      wageringEnabled: true,
      reason: 'Enable wagering for Q1 campaign',
    });

    const audits = h.auditRepo.items as Array<Record<string, unknown>>;
    const settingsAudits = audits.filter(
      (a) => a.action === 'WAGERING_SETTINGS_UPDATE',
    );
    expect(settingsAudits.length).toBe(1);
    expect(
      (settingsAudits[0].newValue as Record<string, unknown>).policyVersion,
    ).toBe(2);
    expect(h.settings.activationTimestamp).toBeInstanceOf(Date);
  });

  it('queues a user notification for override changes', async () => {
    const h = makeHarness({ notifyUsers: true });
    await h.service.setOverride(ADMIN, USER, 2, 'Adjusted for fairness');

    const notifications = h.notificationRepo.items as Array<
      Record<string, unknown>
    >;
    expect(notifications.some((n) => n.kind === 'OVERRIDE_APPLIED')).toBe(true);
  });
});

describe('WageringService — financial safety (fees, refunds, cancelled/reversed)', () => {
  it.each([['CANCELLED'], ['REFUNDED'], ['REVERSED'], ['FAILED']] as const)(
    'never counts %s activity',
    async (outcome) => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: `non-settled-${outcome}`,
      amount: `10000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: outcome,
    });

    expect(result.status).toBe('NOT_SETTLED');
    // No wagering rows, no obligation movement — the balance/ledger untouched.
    expect(h.eventRepo.items.length).toBe(0);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`0.${TDX_18}`);
    },
  );

  it('counts only SETTLED activity', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    const result = await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: 'settled-ok',
      amount: `1000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    expect(result.status).toBe('COUNTED');
    expect(h.eventRepo.items.length).toBe(1);
  });

  it('excludes fees from wagering volume with exact decimal arithmetic', () => {
    // Lotto: 10000 stake with the 3% in-ticket deduction (2% referral + 1% admin).
    expect(netStakeAfterFees(`10000.${TDX_18}`, [`300.${TDX_18}`])).toBe(
      `9700.${TDX_18}`,
    );
    // Pulse trade: multiple fee legs sum exactly (no floating point drift).
    expect(
      netStakeAfterFees(`100.${TDX_18}`, [
        `0.1${TDX_18.slice(1)}`,
        `0.2${TDX_18.slice(1)}`,
      ]),
    ).toBe(`99.7${TDX_18.slice(1)}`);
    // No fees → full stake (fee-free activity is fully counted).
    expect(netStakeAfterFees(`500.${TDX_18}`, [])).toBe(`500.${TDX_18}`);
    // Fee-dominated records clamp at zero — never negative volume.
    expect(netStakeAfterFees(`10.${TDX_18}`, [`25.${TDX_18}`])).toBe(
      `0.${TDX_18}`,
    );
    // Sub-cent precision preserved exactly (18dp, no float rounding).
    expect(
      netStakeAfterFees(
        `0.000000000000000003`,
        [`0.000000000000000001`],
      ),
    ).toBe(`0.000000000000000002`);
  });
});

describe('Wagering admin access control (AdminGuard + MFA/AAL2)', () => {
  it('rejects non-admin users', () => {
    const policy = new AdminAccessPolicy(
      {
        findOne: async () => ({ id: USER, role: 'user', status: 'active' }),
      } as never,
      { get: () => '' } as never,
    );
    const decision = policy.decide({
      id: USER,
      role: 'user',
      status: 'active',
    } as never);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NOT_ADMIN');
  });

  it('requires MFA (AAL2) for admin operations', () => {
    const policy = new AdminAccessPolicy(
      {
        findOne: async () => ({ id: ADMIN, role: 'admin', status: 'active' }),
      } as never,
      { get: () => '' } as never,
    );

    expect(policy.decideMfa('aal1').allowed).toBe(false);
    expect(policy.decideMfa('aal1').reason).toBe('MFA_REQUIRED');
    expect(policy.decideMfa('aal2').allowed).toBe(true);
    expect(policy.decideMfa('aal2').reason).toBe('AAL2_SATISFIED');
  });

  it('wagering admin routes are guarded by AdminGuard', () => {
    const guardNames = Reflect.getMetadata(
      '__guards__',
      WageringAdminController,
    ) as Array<new () => unknown>;
    expect(guardNames.map((g) => g.name)).toContain('AdminGuard');
  });

  it('allows active admins and the legacy admin wallet decision', () => {
    const policy = new AdminAccessPolicy(
      { findOne: async () => null } as never,
      { get: () => '0xadminwallet' } as never,
    );
    const legacy = policy.decide({
      id: USER,
      role: 'user',
      status: 'active',
      walletAddress: '0xAdminWallet',
    } as never);
    expect(legacy.allowed).toBe(true);
    expect(legacy.reason).toBe('LEGACY_ADMIN_WALLET');

    const inactive = policy.decide({
      id: USER,
      role: 'admin',
      status: 'suspended',
    } as never);
    expect(inactive.allowed).toBe(false);
  });
});

// =====================================================================
// FIX-ERA TESTS: event reconciliation, expiry enforcement, migration
// rollback safety, missing settlementOutcome, notification policy
// =====================================================================

describe('WageringService — settlement event reconciliation (H1)', () => {
  it('replays missed lotto volume from ledger evidence (fee-excluded)', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    const creditedAt = new Date(Date.now() - 60 * 60 * 1000); // outside safety window
    h.ledgerRepo.items.push({
      id: 'le-g1',
      type: 'GAME_ENTRY',
      referenceType: 'LOTTO_TICKET',
      referenceId: '1',
      amount: `9700.${TDX_18}`,
      userId: USER,
      createdAt: creditedAt,
    });
    h.lottoTicketRepo.items.push({
      id: 1,
      userId: USER,
      status: 'WIN',
      netAmount: `9700.${TDX_18}`,
    });

    const result = await h.service.reconcileWageringEvents(null);
    expect(result.counted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`9700.${TDX_18}`);
  });

  it('reconstructs pulse-trade stake minus fee legs exactly', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    const creditedAt = new Date(Date.now() - 60 * 60 * 1000);
    h.ledgerRepo.items.push({
      id: 'le-t1',
      type: 'TRADE_ENTRY',
      referenceType: 'pulse_trade',
      referenceId: 'tr-1',
      amount: `1000.${TDX_18}`,
      userId: USER,
      createdAt: creditedAt,
    });
    h.ledgerRepo.items.push({
      id: 'le-fee1',
      type: 'TRADE_FEE',
      referenceType: 'TRADE_FEE_ALLOCATION',
      referenceId: 'tr-1',
      amount: `30.${TDX_18}`,
      userId: USER,
      createdAt: creditedAt,
    });
    h.tradeRepo.items.push({
      id: 'tr-1',
      userId: USER,
      status: 'SETTLED',
      result: 'WIN',
    });

    const result = await h.service.reconcileWageringEvents(null);
    expect(result.counted).toBe(1);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`970.${TDX_18}`);
  });

  it('excludes refunded/cancelled and non-settled activity', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());
    const creditedAt = new Date(Date.now() - 60 * 60 * 1000);

    h.ledgerRepo.items.push({
      id: 'le-g2',
      type: 'GAME_ENTRY',
      referenceType: 'LOTTO_TICKET',
      referenceId: '2',
      amount: `500.${TDX_18}`,
      createdAt: creditedAt,
    });
    h.lottoTicketRepo.items.push({
      id: 2,
      userId: USER,
      status: 'REFUNDED',
      netAmount: `500.${TDX_18}`,
    });

    h.ledgerRepo.items.push({
      id: 'le-t2',
      type: 'TRADE_ENTRY',
      referenceType: 'pulse_trade',
      referenceId: 'tr-2',
      amount: `500.${TDX_18}`,
      createdAt: creditedAt,
    });
    h.tradeRepo.items.push({
      id: 'tr-2',
      userId: USER,
      status: 'SETTLED',
      result: 'DRAW', // refund-like; never counts
    });

    const result = await h.service.reconcileWageringEvents(null);
    expect(result.counted).toBe(0);
    expect(result.skipped).toBe(2);
    expect(h.eventRepo.items.length).toBe(0);
  });

  it('skips very recent entries inside the safety window', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());

    h.ledgerRepo.items.push({
      id: 'le-g3',
      type: 'GAME_ENTRY',
      referenceType: 'LOTTO_TICKET',
      referenceId: '3',
      amount: `500.${TDX_18}`,
      createdAt: new Date(), // in-flight: the real-time hook owns it
    });
    h.lottoTicketRepo.items.push({
      id: 3,
      userId: USER,
      status: 'WIN',
      netAmount: `500.${TDX_18}`,
    });

    const result = await h.service.reconcileWageringEvents(null);
    expect(result.scanned).toBe(0);
    expect(result.counted).toBe(0);
    expect(h.eventRepo.items.length).toBe(0);
  });

  it('does not duplicate volume on replay (idempotent)', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(makeObligation());
    const creditedAt = new Date(Date.now() - 60 * 60 * 1000);

    h.ledgerRepo.items.push({
      id: 'le-g4',
      type: 'GAME_ENTRY',
      referenceType: 'LOTTO_TICKET',
      referenceId: '4',
      amount: `1000.${TDX_18}`,
      createdAt: creditedAt,
    });
    h.lottoTicketRepo.items.push({
      id: 4,
      userId: USER,
      status: 'SETTLED',
      netAmount: `1000.${TDX_18}`,
    });

    const first = await h.service.reconcileWageringEvents(null);
    const second = await h.service.reconcileWageringEvents(null);

    expect(first.counted).toBe(1);
    expect(second.counted).toBe(0); // already has event legs
    const events = h.eventRepo.items as Array<Record<string, unknown>>;
    expect(events.filter((e) => e.sourceId === '4').length).toBe(1);
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).completedAmount,
    ).toBe(`1000.${TDX_18}`);
  });

  it('does nothing when wagering is disabled and always writes an audit row', async () => {
    const h = makeHarness({ wageringEnabled: false });
    const disabled = await h.service.reconcileWageringEvents(null);
    expect(disabled.counted).toBe(0);

    const enabledHarness = makeHarness();
    enabledHarness.obligationRepo.items.push(makeObligation());
    enabledHarness.ledgerRepo.items.push({
      id: 'le-g5',
      type: 'GAME_ENTRY',
      referenceType: 'LOTTO_TICKET',
      referenceId: '5',
      amount: `100.${TDX_18}`,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    enabledHarness.lottoTicketRepo.items.push({
      id: 5,
      userId: USER,
      status: 'WIN',
      netAmount: `100.${TDX_18}`,
    });
    await enabledHarness.service.reconcileWageringEvents(ADMIN);

    const audits = enabledHarness.auditRepo.items as Array<
      Record<string, unknown>
    >;
    const run = audits.find((a) => a.action === 'WAGERING_EVENT_RECONCILE_RUN');
    expect(run).toBeDefined();
    expect((run?.newValue as Record<string, unknown>).scanned).toBe(1);
  });
});

describe('WageringService — expired obligations (H2)', () => {
  it('an expired obligation does not block withdrawal', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({ expiresAt: new Date(Date.now() - 1000) }),
    );

    // getUserWageringSummary expire-first transition flips it, so remaining is 0.
    const summary = await h.service.getUserWageringSummary(USER);
    expect(summary.totalRemaining.toFixed(18)).toBe(`0.${TDX_18}`);
    expect(summary.withdrawalEligible).toBe(true);

    const check = await h.service.assertWithdrawalAllowed(USER);
    expect(check.allowed).toBe(true);
    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.status).toBe(WageringObligationStatus.EXPIRED);
    // Snapshot preserved — nothing deleted.
    expect(ob.requiredAmount).toBe(`20000.${TDX_18}`);
  });

  it('an active unexpired obligation still blocks withdrawal', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({ expiresAt: new Date(Date.now() + 86_400_000) }),
    );

    // Enforcement throws before any mutation; the obligation stays ACTIVE.
    await expect(h.service.assertWithdrawalAllowed(USER)).rejects.toThrow(
      ForbiddenException,
    );
    expect(
      (h.obligationRepo.items[0] as Record<string, unknown>).status,
    ).toBe(WageringObligationStatus.ACTIVE);
  });

  it('expired obligations never absorb new wagering volume', async () => {
    const h = makeHarness();
    h.obligationRepo.items.push(
      makeObligation({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: 'exp-1',
      amount: `5000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });

    const ob = h.obligationRepo.items[0] as Record<string, unknown>;
    expect(ob.status).toBe(WageringObligationStatus.EXPIRED);
    expect(ob.completedAmount).toBe(`0.${TDX_18}`);
    // Surplus row preserved for audit.
    const events = h.eventRepo.items as Array<Record<string, unknown>>;
    expect(events.some((e) => e.status === WageringEventStatus.REJECTED)).toBe(
      true,
    );
  });
});

describe('Migration down() rollback safety (H3)', () => {
  function makeQueryRunner(tables: Record<string, number>): { query: jest.Mock } {
    return {
      query: jest.fn(async (sql: string) => {
        // Table-existence probe (information_schema) — both tables exist.
        if (sql.includes('information_schema.tables')) return [{ exists: 1 }];
        if (sql.startsWith('SELECT COUNT(*)')) {
          const name = sql.match(/FROM "([^"]+)"/)?.[1] ?? '';
          return [{ count: tables[name] ?? 0 }];
        }
        return [];
      }),
    };
  }

  it('refuses rollback when live obligations exist', async () => {
    const migration = new CreateWageringSystem1788000000000();
    const qr = makeQueryRunner({ wagering_obligations: 3, wagering_events: 0 });
    await expect(migration.down(qr as never)).rejects.toThrow(
      /rollback refused/i,
    );
    expect(
      qr.query.mock.calls.some((c) => /DROP TABLE/.test(String(c[0]))),
    ).toBe(false);
  });

  it('refuses rollback when live events exist', async () => {
    const migration = new CreateWageringSystem1788000000000();
    const qr = makeQueryRunner({ wagering_obligations: 0, wagering_events: 7 });
    await expect(migration.down(qr as never)).rejects.toThrow(
      /rollback refused/i,
    );
  });

  it('proceeds when tables are empty', async () => {
    const migration = new CreateWageringSystem1788000000000();
    const qr = makeQueryRunner({ wagering_obligations: 0, wagering_events: 0 });
    await expect(migration.down(qr as never)).resolves.toBeUndefined();
    expect(
      qr.query.mock.calls.some((c) => /DROP TABLE/.test(String(c[0]))),
    ).toBe(true);
  });
});

describe('Notification policy (Fix 5)', () => {
  it('override notifications are always created even when notifyUsers is false', async () => {
    const h = makeHarness({ notifyUsers: false });
    await h.service.setOverride(ADMIN, USER, 3, 'Fairness adjustment');
    const notifications = h.notificationRepo.items as Array<
      Record<string, unknown>
    >;
    expect(notifications.some((n) => n.kind === 'OVERRIDE_APPLIED')).toBe(true);
  });

  it('obligation-completed notifications respect notifyUsers=false', async () => {
    const h = makeHarness({ notifyUsers: false });
    h.obligationRepo.items.push(makeObligation());
    await h.service.recordWageredVolume({
      userId: USER,
      activityType: WageringActivityType.LOTTO,
      sourceType: LOTTO_SOURCE_TYPE,
      sourceId: 'notif-1',
      amount: `20000.${TDX_18}`,
      ledgerType: 'GAME_ENTRY',
      settlementOutcome: 'SETTLED',
    });
    const notifications = h.notificationRepo.items as Array<
      Record<string, unknown>
    >;
    expect(
      notifications.some((n) => n.kind === 'OBLIGATION_COMPLETED'),
    ).toBe(false);
  });
});