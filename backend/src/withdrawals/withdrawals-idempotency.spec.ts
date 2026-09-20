import { ConflictException } from '@nestjs/common';

import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { WithdrawalsService } from './withdrawals.service';

/**
 * Phase B/C / E7 / E8 / E9 / E10 / E11 / E15 — source-aware withdrawal +
 * clientRequestId idempotency + blocking-status correctness.
 */
const USER_ID = '11111111-2222-3333-4444-555555555555';
const WALLET = '0x' + 'ab'.repeat(20);
const TOKEN = '0x' + 'cd'.repeat(20);
const KEY = 'client-req-1';

type CaughtHttpError = Error & {
  status?: number;
  response?: Record<string, unknown>;
};

function makeRow(overrides: Partial<Withdrawal> = {}): Withdrawal {
  return {
    id: 'w-1',
    userId: USER_ID,
    walletAddress: WALLET,
    chainId: 56,
    tokenAddress: TOKEN,
    tdxAmount: '1000.000000000000000000',
    usdtAmount: '10.000000000000000000',
    fee: '0',
    status: WithdrawalStatus.PENDING_ADMIN_APPROVAL,
    riskPassed: true,
    liquidityPassed: true,
    adminApproved: false,
    payoutAttempted: false,
    clientRequestId: KEY,
    metadata: {},
    rejectionReason: undefined,
    ...overrides,
  } as unknown as Withdrawal;
}

interface HarnessOptions {
  /** Row returned by the blocking status lookup. */
  blocking?: Withdrawal | null;
  /** Row returned for a (userId, clientRequestId) lookup. */
  existing?: Withdrawal | null;
}

function makeHarness(options: HarnessOptions = {}) {
  const rows: Withdrawal[] = [];
  if (options.existing) rows.push(options.existing);

  const walletSourceService: any = {
    ensureLegacyAttribution: jest.fn(async () => undefined),
    reserveFifo: jest.fn(async () => [
      {
        bucketId: 'b-1',
        sourceType: 'REFERRAL_COMMISSION',
        amount: '1000.000000000000000000',
      },
    ]),
    releaseReservation: jest.fn(async () => undefined),
    commitReservation: jest.fn(async () => undefined),
  };

  const assertWithdrawalAllowed = jest.fn(async () => ({
    allowed: true,
    remainingWagering: '0',
    obligationIds: [],
  }));

  const repo: any = {
    findOne: jest.fn(
      async (opts?: {
        where?: { id?: string; status?: unknown; clientRequestId?: string };
      }) => {
        const where = opts?.where ?? {};
        if (where.id) return rows.find((r) => r.id === where.id) ?? null;
        if (where.status !== undefined) {
          // The service passes a TypeORM In(...) operator; unwrap the values
          // and emulate `status IN (blocking statuses)` faithfully.
          const op = where.status as { _type?: string; _value?: string[] };
          const blockingValues = Array.isArray(op?._value)
            ? op._value
            : [where.status];
          const blockingRow = options.blocking ?? null;
          if (!blockingRow) return null;
          return blockingValues.includes(blockingRow.status)
            ? blockingRow
            : null;
        }
        if (where.clientRequestId !== undefined) {
          return (
            rows.find((r) => r.clientRequestId === where.clientRequestId) ??
            null
          );
        }
        return null;
      },
    ),
    create: (data: Record<string, unknown>) => ({
      id: `w-${rows.length + 1}`,
      ...data,
    }),
    save: jest.fn(async (row: Withdrawal) => {
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
      return row;
    }),
    createQueryBuilder: () => {
      const qb: any = {};
      qb.where = () => qb;
      qb.andWhere = () => qb;
      qb.setLock = () => qb;
      qb.getMany = jest.fn(async () => []);
      qb.getCount = jest.fn(async () => 0);
      return qb;
    },
  };

  const balanceRepo: any = {
    findOne: jest.fn(async () => ({
      userId: USER_ID,
      availableBalance: '1000000.000000000000000000',
      // Reflects a withdrawal whose reserve is still held, so release/consume
      // paths behave like production.
      lockedBalance: '1000.000000000000000000',
      withdrawalLocked: '1000.000000000000000000',
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
      return repo;
    }),
  };

  // Serialize concurrent transactions the way a real per-user advisory lock
  // does, so the in-transaction idempotency re-check is exercised.
  let chain: Promise<unknown> = Promise.resolve();
  const dataSource: any = {
    transaction: jest.fn(async (cb: (m: any) => Promise<unknown>) => {
      const previous = chain;
      let release!: () => void;
      chain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await cb(manager);
      } finally {
        release();
      }
    }),
    manager: { getRepository: () => repo },
  };

  const limitsService: any = {
    getDailyWithdrawalFrequency: jest.fn(async () => ({ mode: 'UNLIMITED' })),
    assertWithdrawalAmount: jest.fn(async () => undefined),
  };

  const service = new WithdrawalsService(
    repo,
    { findOne: jest.fn() } as any,
    dataSource,
    { isSupportedPayoutConfiguration: () => true } as any,
    { validateOwnership: jest.fn() } as any,
    { get: () => undefined } as any,
    { assertWithdrawalAllowed } as any,
    limitsService,
    walletSourceService,
  );

  (service as unknown as Record<string, unknown>).validateWalletOwnership =
    jest.fn(async () => undefined);

  return {
    service,
    rows,
    repo,
    manager,
    walletSourceService,
    assertWithdrawalAllowed,
    limitsService,
    dataSource,
  };
}

describe('WithdrawalsService — clientRequestId idempotency', () => {
  it('replays the ORIGINAL withdrawal for the same (user, clientRequestId) (E8)', async () => {
    const original = makeRow();
    const h = makeHarness({ existing: original });

    const result = await h.service.createWithdrawal(
      USER_ID,
      WALLET,
      56,
      TOKEN,
      '1000',
      KEY,
    );

    expect(result).toBe(original);
    expect(h.rows).toHaveLength(1);
    expect(h.repo.save).not.toHaveBeenCalled();
  });

  it('rejects the same key with a DIFFERENT amount (E9)', async () => {
    const h = makeHarness({ existing: makeRow() });

    let caught: CaughtHttpError | null = null;
    try {
      await h.service.createWithdrawal(
        USER_ID,
        WALLET,
        56,
        TOKEN,
        '2000', // different amount, same key
        KEY,
      );
    } catch (error) {
      caught = error as CaughtHttpError;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught?.response).toMatchObject({
      code: 'WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH',
    });
    expect(h.rows).toHaveLength(1);
  });

  it('rejects the same key with a different wallet address (E9)', async () => {
    const otherWallet = '0x' + 'ef'.repeat(20);
    const h = makeHarness({ existing: makeRow() });

    await expect(
      h.service.createWithdrawal(USER_ID, otherWallet, 56, TOKEN, '1000', KEY),
    ).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH' },
    });
  });

  it('rejects the same key with a different chain (E9)', async () => {
    const h = makeHarness({ existing: makeRow() });

    await expect(
      h.service.createWithdrawal(USER_ID, WALLET, 137, TOKEN, '1000', KEY),
    ).rejects.toMatchObject({
      response: { code: 'WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH' },
    });
  });

  it('concurrent duplicates create exactly ONE withdrawal (E7)', async () => {
    const h = makeHarness();

    const [first, second] = await Promise.all([
      h.service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000', KEY),
      h.service.createWithdrawal(USER_ID, WALLET, 56, TOKEN, '1000', KEY),
    ]);

    expect(first.id).toBe(second.id);
    expect(h.rows).toHaveLength(1);
    // Only one source reserve + one balance reserve happened.
    expect(h.walletSourceService.reserveFifo).toHaveBeenCalledTimes(1);
  });

  it('reserves the FIFO source attribution INSIDE the creation transaction', async () => {
    const h = makeHarness();

    await h.service.createWithdrawal(
      USER_ID,
      WALLET,
      56,
      TOKEN,
      '1000',
      undefined,
    );

    expect(h.walletSourceService.ensureLegacyAttribution).toHaveBeenCalledTimes(
      1,
    );
    expect(h.walletSourceService.reserveFifo).toHaveBeenCalledTimes(1);
    // Wagering enforcement received the requested amount => source-aware.
    expect(h.assertWithdrawalAllowed).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
      '1000.000000000000000000',
    );
    // The legs are persisted on the withdrawal for later commit/release.
    const created = h.rows[0] as unknown as {
      metadata: {
        sourceAllocation: { legs: Array<Record<string, string>> };
      };
    };
    expect(created.metadata.sourceAllocation.legs).toEqual([
      {
        bucketId: 'b-1',
        sourceType: 'REFERRAL_COMMISSION',
        amount: '1000.000000000000000000',
      },
    ]);
  });
});


describe('WithdrawalsService — blocking statuses (E10 / E11)', () => {
  const blockingCases: Array<[WithdrawalStatus, string]> = [
    [WithdrawalStatus.APPROVED, 'E10 — APPROVED blocks a new withdrawal'],
    [WithdrawalStatus.HOLD, 'E11 — HOLD blocks a new withdrawal'],
    [WithdrawalStatus.PROCESSING, 'PROCESSING blocks a new withdrawal'],
    [WithdrawalStatus.QUEUED, 'QUEUED blocks a new withdrawal'],
    [WithdrawalStatus.SENT, 'SENT blocks a new withdrawal'],
    [
      WithdrawalStatus.PENDING_ADMIN_APPROVAL,
      'PENDING_ADMIN_APPROVAL blocks a new withdrawal',
    ],
    [WithdrawalStatus.REQUESTED, 'REQUESTED blocks a new withdrawal'],
  ];

  for (const [status, name] of blockingCases) {
    it(name, async () => {
      const h = makeHarness({
        blocking: makeRow({ status } as Partial<Withdrawal>),
      });

      let caught: CaughtHttpError | null = null;
      try {
        await h.service.createWithdrawal(
          USER_ID,
          WALLET,
          56,
          TOKEN,
          '1000',
          undefined,
        );
      } catch (error) {
        caught = error as CaughtHttpError;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught?.status).toBe(409);
      expect(h.rows).toHaveLength(0);
      expect(h.repo.save).not.toHaveBeenCalled();
    });
  }

  it('terminal REJECTED / FAILED / CANCELLED do not block a new withdrawal', async () => {
    for (const status of [
      WithdrawalStatus.REJECTED,
      WithdrawalStatus.FAILED,
      WithdrawalStatus.CANCELLED,
    ]) {
      const h = makeHarness({
        blocking: makeRow({ status } as Partial<Withdrawal>),
      });

      const result = await h.service.createWithdrawal(
        USER_ID,
        WALLET,
        56,
        TOKEN,
        '1000',
        undefined,
      );
      // The flow proceeded past the blocking check: risk passed, so the
      // withdrawal reaches PENDING_ADMIN_APPROVAL.
      expect(result.status).toBe(WithdrawalStatus.PENDING_ADMIN_APPROVAL);
    }
  });
});


describe('WithdrawalsService — reservation restore on rejection (E15)', () => {
  it('releases the balance reserve AND the FIFO source legs on pre-payout rejection', async () => {
    const withdrawal = makeRow({
      status: WithdrawalStatus.RISK_CHECKING,
      metadata: {
        sourceAllocation: {
          legs: [
            {
              bucketId: 'b-1',
              sourceType: 'DEPOSIT',
              amount: '1000.000000000000000000',
            },
            {
              bucketId: 'b-2',
              sourceType: 'REFERRAL_COMMISSION',
              amount: '250.000000000000000000',
            },
          ],
          reservedAt: new Date().toISOString(),
        },
      },
    } as Partial<Withdrawal>);

    const h = makeHarness();
    h.repo.findOne.mockImplementation(
      async (opts?: { where?: { id?: string } }) =>
        opts?.where?.id === withdrawal.id ? withdrawal : null,
    );

    const rejected = await (
      h.service as unknown as {
        rejectBeforeBroadcast: (
          id: string,
          status: WithdrawalStatus,
          reason: string,
        ) => Promise<Withdrawal>;
      }
    ).rejectBeforeBroadcast(withdrawal.id, WithdrawalStatus.REJECTED, 'risk');

    expect(rejected.status).toBe(WithdrawalStatus.REJECTED);
    const rejectedMeta = rejected.metadata as unknown as {
      reserve: { released: boolean };
    };
    expect(rejectedMeta.reserve.released).toBe(true);
    expect(h.walletSourceService.releaseReservation).toHaveBeenCalledWith(
      [
        {
          bucketId: 'b-1',
          sourceType: 'DEPOSIT',
          amount: '1000.000000000000000000',
        },
        {
          bucketId: 'b-2',
          sourceType: 'REFERRAL_COMMISSION',
          amount: '250.000000000000000000',
        },
      ],
      expect.anything(),
    );
  });

  it('commits the FIFO source legs when the payout completes', async () => {
    const withdrawal = makeRow({
      status: WithdrawalStatus.APPROVED,
      metadata: {
        sourceAllocation: {
          legs: [
            {
              bucketId: 'b-1',
              sourceType: 'DEPOSIT',
              amount: '1000.000000000000000000',
            },
          ],
          reservedAt: new Date().toISOString(),
        },
      },
    } as Partial<Withdrawal>);

    const h = makeHarness();
    h.repo.findOne.mockImplementation(
      async (opts?: { where?: { id?: string } }) =>
        opts?.where?.id === withdrawal.id ? withdrawal : null,
    );

    await (
      h.service as unknown as {
        consumeReserve: (m: unknown, w: Withdrawal) => Promise<void>;
      }
    ).consumeReserve(h.manager, withdrawal);

    expect(h.walletSourceService.commitReservation).toHaveBeenCalledWith(
      [
        {
          bucketId: 'b-1',
          sourceType: 'DEPOSIT',
          amount: '1000.000000000000000000',
        },
      ],
      expect.anything(),
    );
  });
});

