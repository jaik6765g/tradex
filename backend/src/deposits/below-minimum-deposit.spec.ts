import Decimal from 'decimal.js';

import { Deposit, DepositStatus } from './deposit.entity';
import {
  DEPOSIT_BELOW_MINIMUM_CREDITED_ACTION,
  DEPOSIT_BELOW_MINIMUM_REJECTED_ACTION,
  DepositService,
} from './deposit.service';

// ============================================================
// Stubs
// ============================================================

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TX = '0x' + '11'.repeat(32);
const ADMIN_ID = 'ffffffff-1111-2222-3333-444444444444';

function makeHarness(
  options: { minDepositUsdt?: string; existing?: Deposit | null } = {},
) {
  const minDepositUsdt = options.minDepositUsdt ?? '10';

  const depositRepo: any = {
    findOne: jest.fn(async () => options.existing ?? null),
    create: (data: Record<string, unknown>) => ({ ...data }) as unknown as Deposit,
    save: jest.fn(async (row: Record<string, unknown>) => ({ id: 'dep-1', ...row })),
    findAndCount: jest.fn(async () => [[], 0]),
  };

  const auditRepo: any = {
    create: (data: Record<string, unknown>) => data,
    save: jest.fn(async (row: Record<string, unknown>) => row),
  };

  const balanceService: any = { creditTDX: jest.fn(async () => ({ ok: true })) };

  const limitsService: any = {
    getDepositLimits: jest.fn(async () => ({
      minUsdt: minDepositUsdt,
      maxUsdt: '10000',
    })),
  };

  const manager: any = {
    getRepository: jest.fn((entity: any) =>
      entity?.name === 'Deposit' ? depositRepo : auditRepo,
    ),
  };

  const dataSource: any = {
    transaction: async (cb: (m: any) => Promise<unknown>) => cb(manager),
  };

  const service = new DepositService(
    depositRepo,
    auditRepo,
    balanceService,
    {} as any,
    {} as any,
    {} as any,
    limitsService,
    dataSource,
  );

  return { service, depositRepo, auditRepo, balanceService, limitsService };
}

// ============================================================
// Below-minimum detection (createDeposit)
// ============================================================

describe('DepositService — below-minimum on-chain deposits', () => {
  it('records a sub-minimum deposit as BELOW_MINIMUM with full detection metadata', async () => {
    const { service, depositRepo } = makeHarness({ minDepositUsdt: '10' });

    const saved = await service.createDeposit({
      userId: USER_ID,
      transactionHash: TX,
      chainId: 56,
      usdtAmount: '4.5',
      tdxAmount: '450',
    });

    expect(depositRepo.save).toHaveBeenCalledTimes(1);
    expect(saved.status).toBe(DepositStatus.BELOW_MINIMUM);

    const metadata = (saved as any).metadata;
    expect(metadata.belowMinimum).toMatchObject({
      detected: true,
      minimumAtDetection: '10',
      rateApplied: 100,
    });
    // Detected amount preserved exactly (Decimal.js, 18-decimal string).
    expect(new Decimal(metadata.belowMinimum.usdtAmount).toString()).toBe('4.5');
    expect(metadata.belowMinimum.tdxAmount).toBe('450');
  });

  it('keeps normal deposits on the existing PENDING path', async () => {
    const { service } = makeHarness({ minDepositUsdt: '10' });

    const saved = await service.createDeposit({
      userId: USER_ID,
      transactionHash: TX,
      chainId: 56,
      usdtAmount: '10',
      tdxAmount: '1000',
    });

    expect(saved.status).toBe(DepositStatus.PENDING);
  });

  it('treats a deposit exactly at the minimum as valid (inclusive boundary)', async () => {
    const { service } = makeHarness({ minDepositUsdt: '0.000000000000000010' });

    const saved = await service.createDeposit({
      userId: USER_ID,
      transactionHash: TX,
      chainId: 56,
      usdtAmount: '0.000000000000000010',
      tdxAmount: '1',
    });

    expect(saved.status).toBe(DepositStatus.PENDING);
  });

  it('preserves exactly-once idempotency — re-detection is rejected, never re-recorded', async () => {
    const { service, depositRepo } = makeHarness({
      existing: { id: 'dep-existing', transactionHash: TX } as Deposit,
    });

    await expect(
      service.createDeposit({
        userId: USER_ID,
        transactionHash: TX,
        chainId: 56,
        usdtAmount: '1',
        tdxAmount: '100',
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(depositRepo.save).not.toHaveBeenCalled();
  });

  it('never credits a below-minimum deposit at detection time (zero mutation)', async () => {
    const { service, balanceService } = makeHarness({ minDepositUsdt: '10' });

    await service.createDeposit({
      userId: USER_ID,
      transactionHash: TX,
      chainId: 56,
      usdtAmount: '9.999',
      tdxAmount: '999.9',
    });

    expect(balanceService.creditTDX).not.toHaveBeenCalled();
  });
// ============================================================
// Admin recovery: CREDIT / REJECT
// ============================================================

function belowMinimumRow(): Deposit {
  return {
    id: 'dep-1',
    userId: USER_ID,
    status: DepositStatus.BELOW_MINIMUM,
    usdtAmount: '4.5',
    tdxAmount: '450',
    transactionHash: TX,
    chainId: 56,
    creditedAt: null,
    metadata: {
      belowMinimum: { detected: true, rateApplied: 100, minimumAtDetection: '10' },
    },
  } as unknown as Deposit;
}

describe('DepositService — below-minimum admin recovery', () => {
  it('CREDIT credits the captured detection-time TDX amount, marks COMPLETED and audits', async () => {
    const { service, balanceService, auditRepo } = makeHarness({
      existing: belowMinimumRow(),
    });

    const result = await service.reviewBelowMinimumDeposit(
      'dep-1',
      'CREDIT',
      'Verified on-chain — honouring captured rate',
      { adminId: ADMIN_ID, ipAddress: '1.2.3.4', userAgent: 'jest' },
    );

    // Uses the stored detection-time amount (captured rate), not a re-quote.
    expect(balanceService.creditTDX).toHaveBeenCalledTimes(1);
    const call = balanceService.creditTDX.mock.calls[0];
    expect(call[0]).toBe(USER_ID);
    expect(call[1]).toBe('450');
    expect(call[6]).toBeDefined(); // joins the decision transaction (manager)
    expect(call[5]).toMatchObject({
      rateApplied: 100,
      rateCapturedAtDetection: true,
    });

    expect(result.status).toBe(DepositStatus.COMPLETED);

    const auditRow = auditRepo.save.mock.calls[0][0];
    expect(auditRow.action).toBe(DEPOSIT_BELOW_MINIMUM_CREDITED_ACTION);
    expect(auditRow.targetType).toBe('DEPOSIT');
    expect(auditRow.metadata.reason).toBe(
      'Verified on-chain — honouring captured rate',
    );
    expect(auditRow.oldValue.status).toBe(DepositStatus.BELOW_MINIMUM);
  });

  it('REJECT marks the deposit FAILED with no balance/ledger mutation, and audits', async () => {
    const { service, balanceService, auditRepo } = makeHarness({
      existing: belowMinimumRow(),
    });

    const result = await service.reviewBelowMinimumDeposit(
      'dep-1',
      'REJECT',
      'Below minimum, refunded on-chain out of band',
      { adminId: ADMIN_ID, ipAddress: null, userAgent: null },
    );

    expect(balanceService.creditTDX).not.toHaveBeenCalled();
    expect(result.status).toBe(DepositStatus.FAILED);
    expect(auditRepo.save.mock.calls[0][0].action).toBe(
      DEPOSIT_BELOW_MINIMUM_REJECTED_ACTION,
    );
  });

  it('requires a reason (400 MISSING_REASON) and performs no writes', async () => {
    const { service, balanceService, auditRepo, depositRepo } = makeHarness({
      existing: belowMinimumRow(),
    });

    await expect(
      service.reviewBelowMinimumDeposit('dep-1', 'CREDIT', '   ', {
        adminId: ADMIN_ID,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'MISSING_REASON' },
    });

    expect(balanceService.creditTDX).not.toHaveBeenCalled();
    expect(depositRepo.save).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('is idempotent — a repeated decision cannot double-credit or double-log', async () => {
    const decided = {
      ...belowMinimumRow(),
      status: DepositStatus.COMPLETED,
    } as Deposit;
    const { service, balanceService, auditRepo } = makeHarness({
      existing: decided,
    });

    await expect(
      service.reviewBelowMinimumDeposit('dep-1', 'CREDIT', 'retry', {
        adminId: ADMIN_ID,
        ipAddress: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'DEPOSIT_NOT_AWAITING_BELOW_MINIMUM_REVIEW' },
    });

    expect(balanceService.creditTDX).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });
});

});