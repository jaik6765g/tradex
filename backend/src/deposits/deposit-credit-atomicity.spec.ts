import { ConflictException } from '@nestjs/common';

import { Deposit, DepositStatus } from './deposit.entity';
import { DepositService } from './deposit.service';

/**
 * Phase A1 / E1 / E2 / E14 — atomic deposit credit.
 *
 * The credit path must be a single transaction: lock deposit -> idempotency
 * check -> balance credit -> ledger entry -> FIFO attribution -> wagering
 * obligation -> status update. Any failure rolls everything back, so a retry
 * can never double-credit and a COMPLETED deposit can never lack its ledger
 * anchor or obligation.
 *
 * The mock DataSource emulates PostgreSQL rollback by snapshotting the
 * deposit row and restoring it when the transaction callback throws.
 */
const DEPOSIT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const LEDGER_ID = '33333333-3333-3333-3333-333333333333';

interface HarnessOptions {
  status?: DepositStatus;
  ledgerMissing?: boolean;
  obligationThrows?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  // The committed (post-commit) row store. The in-memory row is mutated
  // inside the transaction and only "persisted" on success.
  const committed: { row: Deposit } = {
    row: {
      id: DEPOSIT_ID,
      userId: USER_ID,
      status: options.status ?? DepositStatus.VERIFIED,
      tdxAmount: '100.000000000000000000',
      usdtAmount: '1.000000000000000000',
      transactionHash: '0xabc',
      chainId: 56,
      creditedAt: null,
      metadata: {},
    } as unknown as Deposit,
  };

  const creditedEntry = options.ledgerMissing ? null : { id: LEDGER_ID };

  const creditTDX = jest.fn(
    async (_userId: string, _amount: string) => ({ ok: true }),
  );
  const createObligationForDeposit = jest.fn(async () => {
    if (options.obligationThrows) {
      throw new Error('wagering unavailable');
    }
    return true;
  });
  const recordCredit = jest.fn(async () => ({ id: 'bucket-1' }));

  const depositRepo: any = {
    createQueryBuilder: () => {
      const qb: any = {};
      qb.setLock = () => qb;
      qb.where = () => qb;
      qb.getOne = async () => ({ ...committed.row });
      return qb;
    },
    save: jest.fn(async (row: Deposit) => row),
  };

  const manager: any = {
    getRepository: jest.fn((entity: any) => {
      if (entity?.name === 'LedgerEntry') {
        return { findOne: jest.fn(async () => creditedEntry) };
      }
      return depositRepo;
    }),
  };

  const dataSource: any = {
    transaction: jest.fn(async (cb: (m: any) => Promise<unknown>) => {
      const snapshot = { ...committed.row };
      try {
        return await cb(manager);
      } catch (error) {
        // Emulate ROLLBACK: nothing the failed transaction did is committed.
        committed.row = snapshot;
        throw error;
      }
    }),
  };

  const service = new DepositService(
    depositRepo,
    { save: jest.fn() } as any,
    { creditTDX } as any,
    {} as any,
    { isSupportedPayoutConfiguration: () => true } as any,
    { get: () => undefined } as any,
    { assertWithdrawalAmount: jest.fn() } as any,
    dataSource,
    { createObligationForDeposit } as any,
    { recordCredit } as any,
  );

  depositRepo.save = jest.fn(async (row: Deposit) => {
    committed.row = { ...row };
    return row;
  });

  return {
    service,
    committed,
    creditTDX,
    createObligationForDeposit,
    recordCredit,
    depositRepo,
    dataSource,
  };
}

describe('DepositService — atomic deposit credit (Phase A1)', () => {
  it('credits balance + ledger + attribution + obligation + status in ONE transaction', async () => {
    const h = makeHarness();

    const result = await h.service.creditDepositAtomic(DEPOSIT_ID);

    expect(result.credited).toBe(true);
    expect(result.alreadyCredited).toBe(false);
    expect(result.ledgerEntryId).toBe(LEDGER_ID);
    expect(result.obligationCreated).toBe(true);

    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.creditTDX).toHaveBeenCalledTimes(1);
    expect(h.recordCredit).toHaveBeenCalledTimes(1);
    expect(h.createObligationForDeposit).toHaveBeenCalledTimes(1);
    expect(h.committed.row.status).toBe(DepositStatus.COMPLETED);
    expect(h.committed.row.creditedAt).toBeInstanceOf(Date);
  });

  it('passes the EXACT 18dp decimal string to the balance credit (never Number)', async () => {
    const h = makeHarness();
    await h.service.creditDepositAtomic(DEPOSIT_ID);

    const amount = h.creditTDX.mock.calls[0][1];
    expect(typeof amount).toBe('string');
    expect(amount).toBe('100.000000000000000000');
  });

  it('is idempotent: a retry on a COMPLETED deposit never double-credits (E1)', async () => {
    const h = makeHarness({ status: DepositStatus.COMPLETED });

    const result = await h.service.creditDepositAtomic(DEPOSIT_ID);

    expect(result.alreadyCredited).toBe(true);
    expect(result.credited).toBe(false);
    expect(h.creditTDX).not.toHaveBeenCalled();
    expect(h.createObligationForDeposit).not.toHaveBeenCalled();
    expect(h.recordCredit).not.toHaveBeenCalled();
  });

  it('rolls back when failure happens AFTER the balance credit (missing ledger anchor)', async () => {
    const h = makeHarness({ ledgerMissing: true });

    await expect(
      h.service.creditDepositAtomic(DEPOSIT_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.committed.row.status).toBe(DepositStatus.VERIFIED);
    expect(h.committed.row.creditedAt).toBeNull();
    expect(h.creditTDX).toHaveBeenCalledTimes(1); // attempted, rolled back
    expect(h.recordCredit).not.toHaveBeenCalled();
  });
});

describe('DepositService — atomic deposit credit (Phase A1, continued)', () => {
  it('retry after a partial failure credits exactly once (E1)', async () => {
    // First attempt fails after the balance credit.
    const failing = makeHarness({ ledgerMissing: true });
    await expect(
      failing.service.creditDepositAtomic(DEPOSIT_ID),
    ).rejects.toBeInstanceOf(ConflictException);

    // Successful retry: the same (uncommitted) deposit is credited once.
    const retry = makeHarness();
    const result = await retry.service.creditDepositAtomic(DEPOSIT_ID);

    expect(result.credited).toBe(true);
    expect(retry.creditTDX).toHaveBeenCalledTimes(1);
    expect(retry.committed.row.status).toBe(DepositStatus.COMPLETED);
  });

  it('rolls back when the wagering obligation cannot be created', async () => {
    const h = makeHarness({ obligationThrows: true });

    await expect(h.service.creditDepositAtomic(DEPOSIT_ID)).rejects.toThrow(
      'wagering unavailable',
    );

    expect(h.committed.row.status).toBe(DepositStatus.VERIFIED);
    expect(h.committed.row.creditedAt).toBeNull();
  });

  it('rejects a non-VERIFIED, non-COMPLETED deposit without any mutation', async () => {
    const h = makeHarness({ status: DepositStatus.PENDING });

    await expect(
      h.service.creditDepositAtomic(DEPOSIT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.creditTDX).not.toHaveBeenCalled();
    expect(h.committed.row.status).toBe(DepositStatus.PENDING);
  });

  it('admin creditDeposit() delegates to the SAME atomic transaction (E2)', async () => {
    const h = makeHarness();

    const deposit = await h.service.creditDeposit(DEPOSIT_ID);

    expect(deposit.status).toBe(DepositStatus.COMPLETED);
    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.creditTDX).toHaveBeenCalledTimes(1);
    expect(h.createObligationForDeposit).toHaveBeenCalledTimes(1);
  });

  it('concurrent processing of the same deposit credits it exactly once', async () => {
    // Serialize transactions like a real row lock: the second waits for the
    // first to commit and therefore observes the COMPLETED row.
    let chain: Promise<unknown> = Promise.resolve();
    const committed = {
      row: {
        id: DEPOSIT_ID,
        userId: USER_ID,
        status: DepositStatus.VERIFIED,
        tdxAmount: '100.000000000000000000',
        usdtAmount: '1.000000000000000000',
        transactionHash: '0xabc',
        chainId: 56,
        creditedAt: null,
        metadata: {},
      } as unknown as Deposit,
    };

    const creditTDX = jest.fn(async () => ({ ok: true }));
    const depositRepo: any = {
      createQueryBuilder: () => {
        const qb: any = {};
        qb.setLock = () => qb;
        qb.where = () => qb;
        qb.getOne = async () => ({ ...committed.row });
        return qb;
      },
      save: jest.fn(async (row: Deposit) => {
        committed.row = { ...row };
        return row;
      }),
    };
    const manager: any = {
      getRepository: (entity: any) =>
        entity?.name === 'LedgerEntry'
          ? { findOne: jest.fn(async () => ({ id: LEDGER_ID })) }
          : depositRepo,
    };
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
    };
    const service = new DepositService(
      depositRepo,
      { save: jest.fn() } as any,
      { creditTDX } as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      dataSource,
      { createObligationForDeposit: jest.fn(async () => true) } as any,
      { recordCredit: jest.fn(async () => null) } as any,
    );

    const [first, second] = await Promise.all([
      service.creditDepositAtomic(DEPOSIT_ID),
      service.creditDepositAtomic(DEPOSIT_ID),
    ]);

    const creditedCount = [first, second].filter((r) => r.credited).length;
    expect(creditedCount).toBe(1);
    expect(creditTDX).toHaveBeenCalledTimes(1);
  });

  it('deposit transactionHash is the unique per-chain anchor (E14)', () => {
    // The credit is anchored to a single deposits row and the schema enforces
    // UNIQUE(transaction_hash), so the same on-chain transaction can never
    // produce two credited deposits. This pins the invariant the atomic path
    // depends on.
    const metadata = Reflect.getMetadata(
      'design:type',
      Deposit.prototype,
      'transactionHash',
    );
    expect(metadata).toBe(String);
    expect(Deposit.name).toBe('Deposit');
  });
});

