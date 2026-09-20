import Decimal from 'decimal.js';

import { Deposit, DepositStatus } from '../deposits/deposit.entity';
import { WageringObligation } from './entities/wagering-obligation.entity';
import { WageringSettings } from './entities/wagering-settings.entity';
import { WageringService } from './wagering.service';
import { FUND_SOURCE_TYPE } from './wagering-source';

/**
 * Phase A2 / E3 / E16 / E19 — generic source-aware wagering obligations.
 *
 *   - a bonus credit creates EXACTLY ONE obligation (idempotent)
 *   - referral commission / salary never create an obligation
 *   - a new deposit AFTER a satisfied obligation creates a NEW obligation
 *   - requiredAmount is exact (amount x multiplier) in Decimal
 */
const USER = '11111111-1111-1111-1111-111111111111';

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
      (r) => x.id !== undefined && r.id === x.id,
    );
    if (idx >= 0) rows[idx] = { ...(rows[idx] as object), ...x };
    else rows.push(x);
    return x as never;
  };
  repo.find = async (opts: { where?: Record<string, unknown> } = {}) =>
    (rows as Array<Record<string, unknown>>).filter((r) =>
      Object.entries(opts.where ?? {}).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v,
      ),
    ) as never;
  repo.findOne = async (opts: { where?: Record<string, unknown> } = {}) =>
    ((rows as Array<Record<string, unknown>>).find((r) =>
      Object.entries(opts.where ?? {}).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v,
      ),
    ) ?? null) as never;
  return repo;
}

function makeDeposit(id: string, amountTdx = '100'): Deposit {
  return {
    id,
    userId: USER,
    status: DepositStatus.COMPLETED,
    tdxAmount: new Decimal(amountTdx).toFixed(18),
    usdtAmount: '1',
    transactionHash: `0x${id}`,
    creditedAt: new Date('2026-02-01T00:00:00Z'),
  } as unknown as Deposit;
}

function makeHarness(maxAgeDays = 30) {
  const obligations: WageringObligation[] = [];
  const settings = {
    id: 's-1',
    singletonKey: 1,
    wageringEnabled: true,
    defaultMultiplier: 2,
    allowedMultipliers: [1, 2, 3, 5, 10],
    eligibleActivity: 'BOTH',
    withdrawalEnforcement: true,
    notifyUsers: false,
    expiryDays: 0,
    reconciliationMaxAgeDays: maxAgeDays,
    activationTimestamp: new Date('2026-01-01T00:00:00Z'),
    policyVersion: 1,
  } as unknown as WageringSettings;

  const settingsRepo = makeListRepo([settings]);
  const overrideRepo = makeListRepo([]);
  const obligationRepo = makeListRepo(obligations);
  const eventRepo = makeListRepo([]);
  const notificationRepo = makeListRepo([]);
  const auditRepo = makeListRepo([]);
  const depositRepo = makeListRepo([]);
  const ledgerRepo = makeListRepo([]);
  const lottoTicketRepo = makeListRepo([]);
  const tradeRepo = makeListRepo([]);

  const manager = {
    getRepository: (entity: unknown) =>
      entity === WageringObligation
        ? obligationRepo
        : entity === WageringSettings
          ? settingsRepo
          : notificationRepo,
  };
  (obligationRepo as Record<string, unknown>).manager = {
    transaction: async (cb: (m: unknown) => Promise<unknown>) => cb(manager),
    getRepository: manager.getRepository,
  };

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

  return { service, obligations, settings };
}

describe('WageringService — generic wagering source model (Phase A2)', () => {
  it('creates EXACTLY ONE obligation for repeated bonus credits (E3)', async () => {
    const h = makeHarness();

    const first = await h.service.createObligationForBonus({
      userId: USER,
      bonusReference: 'bonus-ledger-1',
      ledgerEntryId: 'bonus-ledger-1',
      amountTdx: '50',
      creditedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const second = await h.service.createObligationForBonus({
      userId: USER,
      bonusReference: 'bonus-ledger-1',
      ledgerEntryId: 'bonus-ledger-1',
      amountTdx: '50',
      creditedAt: new Date('2026-02-01T00:00:00Z'),
    });

    expect(first).toBe(true);
    expect(second).toBe(true); // idempotent replay — not a second obligation
    expect(h.obligations).toHaveLength(1);
  });

  it('stores generic source fields: sourceType=BONUS and depositId=null', async () => {
    const h = makeHarness();

    await h.service.createObligationForBonus({
      userId: USER,
      bonusReference: 'bonus-ledger-2',
      ledgerEntryId: 'bonus-ledger-2',
      amountTdx: '25.5',
      creditedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const obligation = h.obligations[0];
    expect(obligation.sourceType).toBe('BONUS');
    expect(obligation.sourceReference).toBe('bonus-ledger-2');
    expect(obligation.depositId).toBeNull();
    // 25.5 x default multiplier 2 — exact Decimal, no float drift.
    expect(obligation.requiredAmount).toBe('51.000000000000000000');
  });

  it('NEVER creates a wagering obligation for referral commission (E19)', async () => {
    const h = makeHarness();

    const created = await h.service.createObligationForSource({
      userId: USER,
      sourceType: FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      sourceReference: 'referral-ledger-1',
      depositId: null,
      ledgerEntryId: 'referral-ledger-1',
      amountTdx: '500',
      creditedAt: new Date('2026-02-01T00:00:00Z'),
    });

    expect(created).toBe(false);
    expect(h.obligations).toHaveLength(0);
  });

  it('NEVER creates a wagering obligation for salary or unknown sources', async () => {
    const h = makeHarness();

    for (const sourceType of [
      FUND_SOURCE_TYPE.SALARY,
      FUND_SOURCE_TYPE.LEGACY,
      FUND_SOURCE_TYPE.OTHER,
      'TOTALLY_UNKNOWN',
    ]) {
      const created = await h.service.createObligationForSource({
        userId: USER,
        sourceType,
        sourceReference: `ref-${sourceType}`,
        depositId: null,
        ledgerEntryId: `le-${sourceType}`,
        amountTdx: '10',
        creditedAt: new Date('2026-02-01T00:00:00Z'),
      });
      expect(created).toBe(false);
    }

    expect(h.obligations).toHaveLength(0);
  });

  it('creates a NEW obligation for a new deposit after an earlier one (E16)', async () => {
    const h = makeHarness();

    await h.service.createObligationForDeposit(makeDeposit('dep-1'), 'le-1');
    await h.service.createObligationForDeposit(makeDeposit('dep-2'), 'le-2');

    expect(h.obligations).toHaveLength(2);
    expect(h.obligations.map((o) => o.sourceReference).sort()).toEqual([
      'dep-1',
      'dep-2',
    ]);
    expect(h.obligations.every((o) => o.sourceType === 'DEPOSIT')).toBe(true);
    expect(h.obligations.every((o) => o.depositId !== null)).toBe(true);
  });

  it('replaying the same deposit obligation keeps exactly one row (idempotent)', async () => {
    const h = makeHarness();
    const deposit = makeDeposit('dep-3');

    await h.service.createObligationForDeposit(deposit, 'le-3');
    await h.service.createObligationForDeposit(deposit, 'le-3');

    expect(h.obligations).toHaveLength(1);
  });
});

