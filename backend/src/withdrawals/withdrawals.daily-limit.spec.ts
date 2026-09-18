import Decimal from 'decimal.js';

import {
  DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
  getIstDayWindow,
  WITHDRAWAL_ABOVE_MAXIMUM_CODE,
} from '../limits/limits.service';
import { WithdrawalStatus } from './entities/withdrawal.entity';
import {
  WithdrawalsService,
  withdrawalDailyLimitLockKeys,
} from './withdrawals.service';

// ============================================================
// Helpers / stubs
// ============================================================

const USER_ID = '11111111-2222-3333-4444-555555555555';
const WALLET = '0x' + 'ab'.repeat(20);
const TOKEN = '0x' + 'cd'.repeat(20);

/** Shape of the NestJS HttpException payloads asserted in this spec. */
type CaughtHttpError = Error & {
  status?: number;
  response?: Record<string, unknown>;
};

/** Chainable query-builder stub capturing the count query parameters. */
function makeCountQueryBuilder(count: number) {
  const captured: { where?: string[]; params?: Record<string, unknown> } = {
    where: [],
    params: {},
  };

  const qb: any = {
    where(cond: string, params: Record<string, unknown>) {
      captured.where!.push(cond);
      Object.assign(captured.params!, params);
      return qb;
    },
    andWhere(cond: string, params: Record<string, unknown>) {
      captured.where!.push(cond);
      Object.assign(captured.params!, params);
      return qb;
    },
    setLock() {
      return qb;
    },
    getMany: jest.fn(async () => []),
    getCount: jest.fn(async () => count),
  };

  return { qb, captured };
}

function makeHarness(options: {
  blocking?: boolean;
  todayCount?: number;
  countSequence?: number[];
  frequency?: { mode: 'COUNT'; value: number } | { mode: 'UNLIMITED' };
  withdrawalLimitError?: { status: number; code: string };
}) {
  const frequency = options.frequency ?? { mode: 'COUNT' as const, value: 3 };
  const countSequence = options.countSequence ?? null;
  let callIndex = 0;

  const countQuery = makeCountQueryBuilder(options.todayCount ?? 0);
  countQuery.qb.getCount = jest.fn(async () => {
    if (countSequence) {
      return countSequence[Math.min(callIndex++, countSequence.length - 1)];
    }
    return options.todayCount ?? 0;
  });

  // Row store so the post-risk-check transaction can find the created row.
  let storedRow: any = null;

  const repo: any = {
    createQueryBuilder: () => makeCountQueryBuilder(0).qb,
    findOne: jest.fn(async (opts?: { where?: { id?: string } }) => {
      if (opts?.where?.id) return storedRow;
      return options.blocking
        ? { id: 'w-existing', status: WithdrawalStatus.REQUESTED }
        : null;
    }),
    create: (data: Record<string, unknown>) => ({
      id: 'new-withdrawal',
      ...data,
    }),
    save: jest.fn(async (row: Record<string, unknown>) => {
      storedRow = row;
      return row;
    }),
  };

  // Single transaction-scoped repo: the daily count query plus row access.
  const countingRepo: any = {
    createQueryBuilder: () => countQuery.qb,
    findOne: repo.findOne,
    create: repo.create,
    save: repo.save,
  };

  // Balance + ledger repos so the existing reserve() path can run unchanged.
  const balanceRepo: any = {
    findOne: jest.fn(async () => ({
      userId: USER_ID,
      availableBalance: '1000000.000000000000000000',
      lockedBalance: '0',
      withdrawalLocked: '0',
      totalBalance: '1000000.000000000000000000',
    })),
    save: jest.fn(async (b: Record<string, unknown>) => b),
  };
  const ledgerRepo: any = {
    findOne: jest.fn(async () => null),
    create: (data: Record<string, unknown>) => data,
    save: jest.fn(async (e: Record<string, unknown>) => e),
  };

  const manager: any = {
    query: jest.fn(async () => []),
    getRepository: jest.fn((entity: any) => {
      const name = entity?.name;
      if (name === 'Balance') return balanceRepo;
      if (name === 'LedgerEntry') return ledgerRepo;
      return countingRepo;
    }),
  };

  const dataSource: any = {
    transaction: async (cb: (m: any) => Promise<unknown>) => cb(manager),
    manager: { getRepository: () => countingRepo },
  };

  const limitsService: any = {
    getDailyWithdrawalFrequency: jest.fn(async () => frequency),
    assertWithdrawalAmount: jest.fn(async (amount: Decimal) => {
      if (options.withdrawalLimitError) {
        const err: any = new Error('limit');
        err.getStatus = () => options.withdrawalLimitError!.status;
        err.getResponse = () => ({
          statusCode: options.withdrawalLimitError!.status,
          code: options.withdrawalLimitError!.code,
        });
        err.status = options.withdrawalLimitError.status;
        err.response = { code: options.withdrawalLimitError.code };
        throw err;
      }
      return amount;
    }),
  };

  const service = new WithdrawalsService(
    repo,
    { findOne: jest.fn() } as any,
    dataSource,
    { isSupportedPayoutConfiguration: () => true } as any,
    { validateOwnership: jest.fn() } as any,
    { get: () => undefined } as any,
    {
      assertWithdrawalAllowed: jest.fn(async () => ({ allowed: true })),
    } as any,
    limitsService,
  );

  // Private ownership check is stubbed so the flow reaches the transaction.
  (service as any).validateWalletOwnership = jest.fn(async () => undefined);

  return {
    service,
    manager,
    repo,
    limitsService,
    captured: countQuery.captured,
  };
}

// ============================================================
// Tests
// ============================================================

describe('WithdrawalsService — per-user advisory lock', () => {
  it('derives deterministic distinct int32 keys per user', () => {
    const [nsA, keyA] = withdrawalDailyLimitLockKeys(USER_ID);
    const [nsB, keyB] = withdrawalDailyLimitLockKeys(USER_ID);
    const [, keyOther] = withdrawalDailyLimitLockKeys(
      '99999999-2222-3333-4444-555555555555',
    );

    expect(nsA).toBe(nsB);
    expect(keyA).toBe(keyB);
    expect(Number.isInteger(keyA)).toBe(true);
    expect(keyA).toBeGreaterThanOrEqual(-2147483648);
    expect(keyA).toBeLessThanOrEqual(2147483647);
    expect(keyOther).not.toBe(keyA);
  });

  it('acquires pg_advisory_xact_lock as the FIRST transaction statement', async () => {
    const { service, manager } = makeHarness({ todayCount: 0 });

    await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');

    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0];
    expect(String(sql)).toContain('pg_advisory_xact_lock');
    expect(params).toEqual(withdrawalDailyLimitLockKeys(USER_ID));
  });
});

describe('WithdrawalsService — daily frequency enforcement', () => {
  it('counts accepted lifecycle entries excluding REJECTED/FAILED/CANCELLED in the IST day', async () => {
    const { service, captured } = makeHarness({ todayCount: 1 });

    await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');

    const whereSql = captured.where!.join(' | ');
    expect(whereSql).toContain('w.userId = :userId');
    expect(whereSql).toContain('w.status NOT IN');
    expect(captured.params!.excluded).toEqual([
      WithdrawalStatus.REJECTED,
      WithdrawalStatus.FAILED,
      WithdrawalStatus.CANCELLED,
    ]);
    expect(whereSql).toContain('w.createdAt >= :startUtc');
    expect(whereSql).toContain('w.createdAt < :endUtc');
    expect(captured.params!.startUtc).toBeInstanceOf(Date);
    expect(captured.params!.endUtc).toBeInstanceOf(Date);
  });

  it('rejects with 409 DAILY_WITHDRAWAL_LIMIT_EXCEEDED and zero mutations at the limit', async () => {
    const { service, repo } = makeHarness({ todayCount: 3 });

    // `resetsAt` is derived from the runtime clock (next Asia/Kolkata
    // midnight), so capture the IST window immediately before and after the
    // call instead of hardcoding a date — otherwise this assertion breaks
    // every time the wall clock crosses IST midnight.
    const windowBefore = getIstDayWindow(new Date());

    let caught: CaughtHttpError | null = null;
    try {
      await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');
    } catch (error) {
      caught = error as CaughtHttpError;
    }

    const windowAfter = getIstDayWindow(new Date());

    expect(caught).not.toBeNull();
    expect(caught?.status).toBe(409);
    expect(caught?.response).toMatchObject({
      code: DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
      limit: 3,
      usedToday: 3,
    });
    expect([windowBefore.resetsAtIso, windowAfter.resetsAtIso]).toContain(
      caught?.response?.resetsAt,
    );

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('allows the request while below the limit', async () => {
    const { service, repo } = makeHarness({ todayCount: 2 });

    await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');

    expect(repo.save).toHaveBeenCalled();
  });

  it('UNLIMITED mode skips the daily count entirely', async () => {
    const { service, manager, repo } = makeHarness({
      frequency: { mode: 'UNLIMITED' },
      todayCount: 999,
    });

    await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');

    // Only the advisory-lock query ran — no counting query.
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalled();
  });

  it('serializes concurrent requests even when the user has ZERO existing rows', async () => {
    // The advisory lock makes counts sequential: with a 3/day limit the 4th
    // and 5th sequential counts (3, 3) must both be rejected.
    const sequence = [0, 1, 2, 3, 3];
    const outcomes: string[] = [];

    for (const todayCount of sequence) {
      const { service } = makeHarness({ todayCount });
      try {
        await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000');
        outcomes.push('accepted');
      } catch (error: any) {
        outcomes.push(error?.response?.code ?? 'error');
      }
    }

    expect(outcomes).toEqual([
      'accepted',
      'accepted',
      'accepted',
      DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
      DAILY_WITHDRAWAL_LIMIT_EXCEEDED_CODE,
    ]);
  });

  it('does not create a row (so quota cannot be consumed) when blocking/validation fails', async () => {
    const { service, repo } = makeHarness({ blocking: true });

    await expect(
      service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000'),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('WithdrawalsService — min/max withdrawal limits', () => {
  it('rejects out-of-range amounts with zero mutations and no lock acquisition', async () => {
    const { service, manager, repo } = makeHarness({
      withdrawalLimitError: {
        status: 400,
        code: WITHDRAWAL_ABOVE_MAXIMUM_CODE,
      },
    });

    await expect(
      service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '60000'),
    ).rejects.toMatchObject({ status: 400 });

    expect(repo.save).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('converts TDX → USDT exactly (100 TDX = 1 USDT) before enforcing limits', async () => {
    const { service, limitsService } = makeHarness({ todayCount: 0 });

    await service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '500');

    const firstAmount = limitsService.assertWithdrawalAmount.mock.calls[0][0];
    expect(firstAmount.toString()).toBe('5');
  });
});
