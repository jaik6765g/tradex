import { EntityManager } from 'typeorm';

import { WalletSourceAllocation } from './entities/wallet-source-allocation.entity';
import { WageringObligation } from './entities/wagering-obligation.entity';
import { WalletSourceService } from './wallet-source.service';
import { FUND_SOURCE_TYPE } from './wagering-source';

/**
 * Phase A2/B — wallet source attribution service.
 *
 * Verifies the attribution layer is idempotent, exact and never becomes a
 * second balance system: it only records/consumes/restores *eligibility* for
 * the authoritative balance.
 */
const USER = '11111111-1111-1111-1111-111111111111';

interface Row extends Partial<WalletSourceAllocation> {
  id: string;
  userId: string;
  sourceId: string;
}

function makeAllocationRepo(rows: Row[]) {
  const repo: any = {};
  let gen = 0;
  repo.items = rows;
  repo.create = (x: Partial<WalletSourceAllocation>) => ({
    id: x.id ?? `b-${(++gen).toString(36)}`,
    createdAt: x.createdAt ?? new Date(Date.now() + gen),
    ...x,
  });
  repo.save = jest.fn(async (x: Row) => {
    const idx = rows.findIndex((r) => r.id === x.id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...x };
    else rows.push(x);
    return x;
  });
  repo.find = jest.fn(
    async (opts: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) =>
        Object.entries(opts.where ?? {}).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ),
  );
  repo.findOne = jest.fn(
    async (opts: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) =>
        Object.entries(opts.where ?? {}).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null,
  );
  repo.createQueryBuilder = () => {
    const params: Record<string, unknown> = {};
    const qb: any = {};
    qb.where = (_c: string, p?: Record<string, unknown>) => {
      Object.assign(params, p ?? {});
      return qb;
    };
    qb.andWhere = () => qb;
    qb.orderBy = () => qb;
    qb.addOrderBy = () => qb;
    qb.setLock = () => qb;
    qb.select = () => qb;
    qb.limit = () => qb;
    qb.getRawMany = jest.fn(async () => {
      const ids = Array.from(new Set(rows.map((r) => r.userId)));
      return ids.map((userId) => ({ userId }));
    });
    qb.getMany = async () =>
      rows
        .filter((r) => {
          if (params.userId && r.userId !== params.userId) return false;
          if (params.status && r.status !== params.status) return false;
          return true;
        })
        .sort(
          (a, b) =>
            new Date(a.createdAt as Date).getTime() -
              new Date(b.createdAt as Date).getTime() ||
            a.id.localeCompare(b.id),
        );
    return qb;
  };
  return repo;
}

function makeObligationRepo(obligations: Partial<WageringObligation>[]) {
  const repo: any = {};
  repo.createQueryBuilder = () => {
    const params: Record<string, unknown> = {};
    const qb: any = {};
    qb.where = (_c: string, p?: Record<string, unknown>) => {
      Object.assign(params, p ?? {});
      return qb;
    };
    qb.andWhere = () => qb;
    qb.getMany = async () =>
      obligations.filter((o) => !params.userId || o.userId === params.userId);
    return qb;
  };
  return repo;
}

function makeHarness(obligations: Partial<WageringObligation>[] = []) {
  const rows: Row[] = [];
  const allocationRepo = makeAllocationRepo(rows);
  const obligationRepo = makeObligationRepo(obligations);
  const balanceRepo = {
    findOne: jest.fn(async () => ({
      userId: USER,
      availableBalance: '0.000000000000000000',
    })),
  };
  const manager = {
    getRepository: (entity: { name?: string }) =>
      entity === WalletSourceAllocation
        ? allocationRepo
        : entity?.name === 'Balance'
          ? balanceRepo
          : obligationRepo,
  } as unknown as EntityManager;
  const dataSource: any = {
    manager,
    getRepository: manager.getRepository,
  };
  const service = new WalletSourceService(allocationRepo, dataSource);
  return {
    service,
    rows,
    allocationRepo,
    balanceRepo,
    manager,
  };
}

describe('WalletSourceService — credit attribution', () => {
  it('classifies DEPOSIT as wagerable and REFERRAL_COMMISSION as not', async () => {
    const h = makeHarness();

    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '100',
    });
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      sourceId: 'ref-1',
      ledgerEntryId: 'le-2',
      amountTdx: '25',
    });

    expect(h.rows).toHaveLength(2);
    const deposit = h.rows.find((r) => r.sourceId === 'dep-1')!;
    const referral = h.rows.find((r) => r.sourceId === 'ref-1')!;
    expect(deposit.wagerable).toBe(true);
    expect(referral.wagerable).toBe(false);
  });

  it('is idempotent by sourceId — a replay never creates a second bucket', async () => {
    const h = makeHarness();

    for (let i = 0; i < 2; i += 1) {
      await h.service.recordCredit({
        manager: h.manager,
        userId: USER,
        sourceType: FUND_SOURCE_TYPE.DEPOSIT,
        sourceId: 'dep-1',
        ledgerEntryId: 'le-1',
        amountTdx: '100',
      });
    }

    expect(h.rows).toHaveLength(1);
  });

  it('fails closed on non-positive/invalid amounts (rolls back the credit)', async () => {
    const h = makeHarness();
    for (const amount of ['0', '-5', 'bad']) {
      await expect(
        h.service.recordCredit({
          manager: h.manager,
          userId: USER,
          sourceType: FUND_SOURCE_TYPE.BONUS,
          sourceId: `b-${amount}`,
          ledgerEntryId: `le-${amount}`,
          amountTdx: amount,
        }),
      ).rejects.toThrow(/Invalid wallet source credit amount/);
    }
    expect(h.rows).toHaveLength(0);
  });
});

describe('WalletSourceService — lazy legacy attribution', () => {
  it('attributes the unattributed balance to ONE non-wagerable LEGACY bucket', async () => {
    const h = makeHarness();

    await h.service.ensureLegacyAttribution(USER, '500', h.manager);

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].sourceType).toBe(FUND_SOURCE_TYPE.LEGACY);
    expect(h.rows[0].wagerable).toBe(false);
    expect(h.rows[0].originalAmount).toBe('500.000000000000000000');
  });

  it('is idempotent and grows only by the new unattributed remainder', async () => {
    const h = makeHarness();

    await h.service.ensureLegacyAttribution(USER, '500', h.manager);
    await h.service.ensureLegacyAttribution(USER, '500', h.manager);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].originalAmount).toBe('500.000000000000000000');

    await h.service.ensureLegacyAttribution(USER, '600', h.manager);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].originalAmount).toBe('600.000000000000000000');
  });
});


describe('WalletSourceService — FIFO reserve / commit / release', () => {
  it('reserves exact FIFO legs and commits them (reserved -> consumed)', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '30',
    });
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      sourceId: 'ref-1',
      ledgerEntryId: 'le-2',
      amountTdx: '50',
    });

    const legs = await h.service.reserveFifo(USER, '60', h.manager);
    expect(legs.map((l) => [l.sourceType, l.amount])).toEqual([
      ['DEPOSIT', '30.000000000000000000'],
      ['REFERRAL_COMMISSION', '30.000000000000000000'],
    ]);

    await h.service.commitReservation(legs, h.manager);

    const deposit = h.rows.find((r) => r.sourceId === 'dep-1')!;
    const referral = h.rows.find((r) => r.sourceId === 'ref-1')!;
    expect(deposit.consumedAmount).toBe('30.000000000000000000');
    expect(deposit.reservedAmount).toBe('0.000000000000000000');
    expect(referral.consumedAmount).toBe('30.000000000000000000');
  });

  it('releases reserved capacity back to available (idempotent)', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '40',
    });

    const legs = await h.service.reserveFifo(USER, '40', h.manager);
    await h.service.releaseReservation(legs, h.manager);
    await h.service.releaseReservation(legs, h.manager); // replay-safe

    const deposit = h.rows.find((r) => r.sourceId === 'dep-1')!;
    expect(deposit.reservedAmount).toBe('0.000000000000000000');
    expect(deposit.consumedAmount).toBe('0.000000000000000000');

    const again = await h.service.reserveFifo(USER, '40', h.manager);
    expect(again).toHaveLength(1);
  });

  it('throws when the requested amount exceeds withdrawable capacity', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '10',
    });

    await expect(h.service.reserveFifo(USER, '25', h.manager)).rejects.toThrow(
      /exceeds withdrawable/,
    );
  });

  it('keeps referral commission withdrawable while a deposit obligation is ACTIVE (E4)', async () => {
    const h = makeHarness([
      {
        userId: USER,
        sourceType: 'DEPOSIT',
        sourceReference: 'dep-1',
        status: 'ACTIVE',
      } as Partial<WageringObligation>,
    ]);
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '1000',
    });
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      sourceId: 'ref-1',
      ledgerEntryId: 'le-2',
      amountTdx: '250',
    });

    const plan = await h.service.getWithdrawablePlan(USER, '250', h.manager);

    expect(plan.plan.fullyFunded).toBe(true);
    expect(plan.plan.legs.map((l) => l.sourceType)).toEqual([
      'REFERRAL_COMMISSION',
    ]);
    expect(plan.plan.blockedWagerableAmount.toFixed()).toBe('1000');
  });
});

describe('WalletSourceService — attribution reconciliation', () => {
  it('detects over-attribution (attributed > authoritative balance)', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '100',
    });

    const report = await h.service.detectAttributionMismatch(
      USER,
      '40',
      h.manager,
    );

    expect(report.overAttributed).toBe(true);
    expect(report.mismatch).toBe(true);
  });

  it('reports a clean state when attribution equals the balance', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '100',
    });

    const report = await h.service.detectAttributionMismatch(
      USER,
      '100',
      h.manager,
    );

    expect(report.overAttributed).toBe(false);
    expect(report.mismatch).toBe(false);
  });
});



describe('WalletSourceService — scheduled attribution reconciliation', () => {
  it('flags users whose attributed capacity exceeds their balance', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '100',
    });

    // Balance 40 < attributed 100 => over-attribution is detected.
    (h.balanceRepo.findOne as jest.Mock).mockImplementationOnce(
      async () => ({ userId: USER, availableBalance: '40' }),
    );

    const result = await h.service.reconcileAttribution(200, h.manager);

    expect(result.scanned).toBe(1);
    expect(result.mismatched).toBe(1);
    expect(result.overAttributedUsers).toEqual([USER]);
  });

  it('reports a clean sweep when attribution matches the balance', async () => {
    const h = makeHarness();
    await h.service.recordCredit({
      manager: h.manager,
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.DEPOSIT,
      sourceId: 'dep-1',
      ledgerEntryId: 'le-1',
      amountTdx: '100',
    });

    (h.balanceRepo.findOne as jest.Mock).mockImplementationOnce(
      async () => ({ userId: USER, availableBalance: '100' }),
    );

    const result = await h.service.reconcileAttribution(200, h.manager);

    expect(result.scanned).toBe(1);
    expect(result.mismatched).toBe(0);
    expect(result.overAttributedUsers).toEqual([]);
  });
});
