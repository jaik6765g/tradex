import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import Decimal from 'decimal.js';

import { AdminService } from './admin.service';
import { DistributeBonusDto } from './dto/admin-bonus.dto';
import {
  ALL_BONUS_CATEGORIES,
  BONUS_CATEGORY,
} from '../wagering/bonus-categories';

// ============================================================
// BONUS CATEGORY WAGERING CONTROL
// ============================================================
//
// Covers the reviewed requirements:
//  - all seven bonus categories accepted (DTO + service)
//  - SALARY_BONUS distributes through the EXISTING bonus flow
//  - wageringRequired=true  → obligation created (with multiplier snapshot)
//  - wageringRequired=false → no obligation
//  - REFERRAL_BONUS + wageringRequired=true → REJECTED (never silent)
//  - 1X / 2X / 3X / CUSTOM multiplier validation (exact decimal)
//  - missing reason rejected
//  - optional future expiry accepted; past/invalid rejected
//  - duplicate idempotencyKey → replay, no double credit
//  - obligation failure → whole distribution rolled back (atomicity)
//  - wagering disabled + wageringRequired=true → rejected, NO credit
// ============================================================

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const CONTEXT = {
  adminId: ADMIN_ID,
  adminEmail: 'admin@tradex.test',
  ipAddress: '1.2.3.4',
  userAgent: 'jest',
};

const ENTITY_TAG = Symbol('entity');

const codeOf = (err: unknown): string | undefined => {
  const response = (err as { getResponse?: () => unknown })?.getResponse?.();
  if (response && typeof response === 'object') {
    const code = (response as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

function makeHarness(options?: {
  existingEntry?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
  obligationResult?: boolean;
}) {
  const calls: string[] = [];
  const savedLedger: any[] = [];
  const savedAudit: any[] = [];

  let balanceRow: any = {
    userId: USER_ID,
    availableBalance: '100.000000000000000000',
    totalBalance: '100.000000000000000000',
    lockedBalance: '0.000000000000000000',
    withdrawalLocked: '0.000000000000000000',
    lastUpdatedAt: new Date(),
  };

  const manager: any = {
    findOne: jest.fn(async (entity: any) =>
      entity?.name === 'User' ? { id: USER_ID } : null,
    ),
    create: jest.fn((entity: any, data: Record<string, unknown>) => {
      const row: any = { ...data, [ENTITY_TAG]: entity?.name };
      return row;
    }),
    save: jest.fn(async (row: any) => {
      const entityName = row?.[ENTITY_TAG];
      if (entityName === 'LedgerEntry') {
        const saved = {
          ...row,
          id: 'ledger-entry-1',
          createdAt: new Date('2026-09-20T10:00:00.000Z'),
        };
        savedLedger.push(saved);
        calls.push('save:ledger');
        return saved;
      }
      if (entityName === 'AdminAuditLog') {
        savedAudit.push(row);
        calls.push('save:audit');
        return row;
      }
      if (entityName === 'Balance') {
        balanceRow = row;
        calls.push('save:balance');
        return row;
      }
      calls.push(`save:${String(entityName)}`);
      return row;
    }),
    createQueryBuilder: jest.fn((entity: any) => {
      if (entity?.name === 'LedgerEntry') {
        const qb: any = {
          where: () => qb,
          andWhere: () => qb,
          getOne: jest.fn(async () => options?.existingEntry ?? null),
        };
        return qb;
      }
      const qb: any = {
        setLock: () => qb,
        where: () => qb,
        getOne: jest.fn(async () => ({
          ...balanceRow,
          [ENTITY_TAG]: 'Balance',
        })),
      };
      return qb;
    }),
  };

  const queryRunner: any = {
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    manager,
  };

  const dataSource: any = {
    createQueryRunner: jest.fn(() => queryRunner),
    manager,
  };

  const wageringService: any = {
    getSettings: jest.fn(
      async () =>
        options?.settings ?? {
          wageringEnabled: true,
          activationTimestamp: new Date(Date.now() - 86_400_000),
        },
    ),
    createObligationForBonus: jest.fn(async () => options?.obligationResult ?? true),
  };

  const walletSourceService: any = {
    recordCredit: jest.fn(async () => null),
  };

  const service = new AdminService(
    {} as any,
    {} as any,
    {} as any,
    dataSource,
    wageringService,
    walletSourceService,
  );

  return {
    service,
    calls,
    savedLedger,
    savedAudit,
    queryRunner,
    wageringService,
    walletSourceService,
  };
}

const baseDto = (
  overrides: Partial<DistributeBonusDto> = {},
): DistributeBonusDto =>
  plainToInstance(DistributeBonusDto, {
    userId: USER_ID,
    amount: 100,
    description: 'Test bonus distribution reason',
    ...overrides,
  } as Record<string, unknown>);

describe('AdminService — bonus category wagering control', () => {
  it('accepts all seven bonus categories at the DTO level', async () => {
    for (const category of ALL_BONUS_CATEGORIES) {
      const errors = await validate(baseDto({ bonusCategory: category }));
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an unknown bonus category at the DTO level', async () => {
    const errors = await validate(baseDto({ bonusCategory: 'NOT_A_CATEGORY' }));
    expect(errors.some((e) => e.property === 'bonusCategory')).toBe(true);
  });

  it('rejects a missing reason at the DTO level', async () => {
    const dto = plainToInstance(DistributeBonusDto, {
      userId: USER_ID,
      amount: 100,
    } as Record<string, unknown>);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'description')).toBe(true);
  });

  it('rejects a missing reason at the SERVICE level too', async () => {
    const h = makeHarness();
    let captured: unknown;
    try {
      await h.service.distributeBonus(baseDto({ description: 'ab' }), CONTEXT);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(BadRequestException);
    expect(codeOf(captured)).toBe('MISSING_BONUS_REASON');
    expect(h.calls).not.toContain('save:balance');
  });

  it('distributes every category through the existing bonus flow', async () => {
    for (const category of ALL_BONUS_CATEGORIES) {
      // REFERRAL_BONUS is always non-wagerable, so YES would be rejected.
      const isReferral = category === BONUS_CATEGORY.REFERRAL_BONUS;
      const h = makeHarness();
      const result = await h.service.distributeBonus(
        baseDto({
          bonusCategory: category,
          wageringRequired: isReferral ? false : true,
        }),
        CONTEXT,
      );

      expect(result.bonusCategory).toBe(category);
      expect(h.savedLedger).toHaveLength(1);
      expect(h.savedLedger[0].metadata.bonusCategory).toBe(category);
      expect(h.walletSourceService.recordCredit).toHaveBeenCalledTimes(1);
      expect(h.calls).toContain('save:balance');
    }
  });

  it('SALARY_BONUS flows through the existing bonus distribution (no salary module)', async () => {
    const h = makeHarness();
    const result = await h.service.distributeBonus(
      baseDto({
        bonusCategory: BONUS_CATEGORY.SALARY_BONUS,
        wageringRequired: true,
        wageringMultiplier: '2',
      }),
      CONTEXT,
    );

    // Same ledger anchor + bucket as every other admin bonus.
    expect(h.savedLedger[0].referenceType).toBe('ADMIN_BONUS');
    expect(h.savedLedger[0].metadata.bonusCategory).toBe('SALARY_BONUS');
    expect(h.walletSourceService.recordCredit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'BONUS' }),
    );
    expect(result.wageringRequired).toBe(true);
    expect(result.obligationCreated).toBe(true);
  });

  it('creates a wagering obligation with the exact multiplier snapshot when YES', async () => {
    const h = makeHarness();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const result = await h.service.distributeBonus(
      baseDto({
        bonusCategory: BONUS_CATEGORY.DEPOSIT_BONUS,
        wageringRequired: true,
        wageringMultiplier: '1.5',
        expiresAt,
      }),
      CONTEXT,
    );

    expect(h.wageringService.createObligationForBonus).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        amountTdx: '100.000000000000000000',
        multiplierOverride: '1.500000000000000000',
        metadata: expect.objectContaining({ bonusCategory: 'DEPOSIT_BONUS' }),
      }),
      expect.anything(),
    );
    const [firstCall] = h.wageringService.createObligationForBonus.mock.calls;
    expect(firstCall[0].expiresAtOverride).toBeInstanceOf(Date);
    expect(result.obligationCreated).toBe(true);
    expect(result.wageringMultiplier).toBe('1.500000000000000000');
  });

  it('does NOT create an obligation when wageringRequired=false', async () => {
    const h = makeHarness();
    const result = await h.service.distributeBonus(
      baseDto({
        bonusCategory: BONUS_CATEGORY.WELCOME_BONUS,
        wageringRequired: false,
        wageringMultiplier: '3',
      }),
      CONTEXT,
    );

    expect(h.wageringService.createObligationForBonus).not.toHaveBeenCalled();
    expect(h.wageringService.getSettings).not.toHaveBeenCalled();
    expect(result.obligationCreated).toBe(false);
    expect(result.wageringRequired).toBe(false);
    expect(result.wageringMultiplier).toBeNull();
    // The credit still happens — just without any wagering requirement.
    expect(h.calls).toContain('save:balance');
  });

  it('REJECTS REFERRAL_BONUS + wageringRequired=true (no silent downgrade)', async () => {
    const h = makeHarness();
    let captured: unknown;
    try {
      await h.service.distributeBonus(
        baseDto({
          bonusCategory: BONUS_CATEGORY.REFERRAL_BONUS,
          wageringRequired: true,
        }),
        CONTEXT,
      );
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(BadRequestException);
    expect(codeOf(captured)).toBe('BONUS_WAGERING_NOT_ALLOWED');
    // Nothing was written at all.
    expect(h.walletSourceService.recordCredit).not.toHaveBeenCalled();
    expect(h.wageringService.createObligationForBonus).not.toHaveBeenCalled();
    expect(h.calls).not.toContain('save:balance');
  });

  it('REFERRAL_BONUS is force-NO and attributed as non-wagerable referral commission', async () => {
    const h = makeHarness();
    const result = await h.service.distributeBonus(
      baseDto({
        bonusCategory: BONUS_CATEGORY.REFERRAL_BONUS,
        wageringRequired: false,
      }),
      CONTEXT,
    );

    expect(result.wageringRequired).toBe(false);
    expect(h.wageringService.createObligationForBonus).not.toHaveBeenCalled();
    expect(h.savedLedger[0].referenceType).toBe('REFERRAL_BONUS');
    expect(h.walletSourceService.recordCredit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'REFERRAL_COMMISSION' }),
    );
  });

  it('accepts 1X / 2X / 3X presets and CUSTOM decimals (exact string math)', async () => {
    for (const multiplier of ['1', '2', '3', '2.5', '0.5']) {
      const h = makeHarness();
      const result = await h.service.distributeBonus(
        baseDto({
          bonusCategory: BONUS_CATEGORY.PROMOTIONAL_BONUS,
          wageringRequired: true,
          wageringMultiplier: multiplier,
        }),
        CONTEXT,
      );
      expect(result.wageringMultiplier).toBe(new Decimal(multiplier).toFixed(18));
      expect(h.wageringService.createObligationForBonus).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects invalid CUSTOM multipliers (zero, negative, non-numeric, over cap)', async () => {
    for (const bad of ['0', '-1', 'abc', '1000.5', '']) {
      const h = makeHarness();
      let captured: unknown;
      try {
        await h.service.distributeBonus(
          baseDto({ wageringRequired: true, wageringMultiplier: bad }),
          CONTEXT,
        );
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(BadRequestException);
      expect(codeOf(captured)).toBe('INVALID_WAGERING_MULTIPLIER');
      expect(h.calls).not.toContain('save:balance');
    }
  });

  it('rejects past/invalid expiry and accepts a future or absent expiry', async () => {
    const past = makeHarness();
    let pastErr: unknown;
    try {
      await past.service.distributeBonus(
        baseDto({
          wageringRequired: true,
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
        CONTEXT,
      );
    } catch (err) {
      pastErr = err;
    }
    expect(codeOf(pastErr)).toBe('BONUS_EXPIRY_IN_PAST');

    const invalid = makeHarness();
    let invalidErr: unknown;
    try {
      await invalid.service.distributeBonus(
        baseDto({ wageringRequired: true, expiresAt: 'not-a-date' }),
        CONTEXT,
      );
    } catch (err) {
      invalidErr = err;
    }
    expect(codeOf(invalidErr)).toBe('INVALID_BONUS_EXPIRY');

    // No expiry at all is valid (optional).
    const none = makeHarness();
    const result = await none.service.distributeBonus(
      baseDto({ wageringRequired: true }),
      CONTEXT,
    );
    expect(result.expiresAt).toBeNull();
    const [call] = none.wageringService.createObligationForBonus.mock.calls;
    expect(call[0].expiresAtOverride).toBeNull();
  });

  it('replays an existing idempotencyKey without a second credit (no double credit)', async () => {
    const h = makeHarness({
      existingEntry: {
        id: 'existing-ledger',
        userId: USER_ID,
        amount: '100.000000000000000000',
        balanceBefore: '0.000000000000000000',
        balanceAfter: '100.000000000000000000',
        description: 'Admin bonus: earlier reason',
        createdAt: new Date('2026-09-19T09:00:00.000Z'),
        metadata: {
          description: 'earlier reason',
          adminId: ADMIN_ID,
          bonusCategory: 'MANUAL_BONUS',
          wageringRequired: true,
        },
      },
    });

    const result = await h.service.distributeBonus(
      baseDto({ idempotencyKey: 'bonus-key-12345678' }),
      CONTEXT,
    );

    expect(result.replayed).toBe(true);
    expect(result.ledgerEntryId).toBe('existing-ledger');
    expect(result.bonusCategory).toBe('MANUAL_BONUS');
    expect(h.calls).not.toContain('save:balance');
    expect(h.walletSourceService.recordCredit).not.toHaveBeenCalled();
    expect(h.wageringService.createObligationForBonus).not.toHaveBeenCalled();
  });

  it('rolls balance + ledger + bucket back when the obligation cannot be created', async () => {
    const h = makeHarness({ obligationResult: false });

    let captured: unknown;
    try {
      await h.service.distributeBonus(baseDto({ wageringRequired: true }), CONTEXT);
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ConflictException);
    expect(codeOf(captured)).toBe('WAGERING_OBLIGATION_NOT_CREATED');
    expect(h.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(h.queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('rejects YES when global wagering is disabled — no unenforced credit', async () => {
    const disabled = makeHarness({
      settings: { wageringEnabled: false, activationTimestamp: null },
    });

    let captured: unknown;
    try {
      await disabled.service.distributeBonus(
        baseDto({ wageringRequired: true }),
        CONTEXT,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ConflictException);
    expect(codeOf(captured)).toBe('WAGERING_REQUIRED_UNAVAILABLE');
    expect(disabled.calls).not.toContain('save:balance');
    expect(disabled.queryRunner.startTransaction).not.toHaveBeenCalled();

    // …but the SAME environment still allows an explicitly non-wagerable bonus.
    const noWagering = makeHarness({
      settings: { wageringEnabled: false, activationTimestamp: null },
    });
    const result = await noWagering.service.distributeBonus(
      baseDto({ wageringRequired: false }),
      CONTEXT,
    );
    expect(result.obligationCreated).toBe(false);
    expect(noWagering.calls).toContain('save:balance');
  });

  it('records the complete audit trail (admin, user, category, amount, wagering, multiplier, expiry, result)', async () => {
    const h = makeHarness();
    await h.service.distributeBonus(
      baseDto({
        bonusCategory: BONUS_CATEGORY.CASHBACK_BONUS,
        wageringRequired: true,
        wageringMultiplier: '3',
        idempotencyKey: 'bonus-key-audit-1',
      }),
      CONTEXT,
    );

    expect(h.savedAudit).toHaveLength(1);
    expect(h.savedAudit[0].adminId).toBe(ADMIN_ID);
    expect(h.savedAudit[0].metadata).toMatchObject({
      userId: USER_ID,
      amount: '100.00',
      bonusCategory: 'CASHBACK_BONUS',
      wageringRequired: true,
      wageringMultiplier: '3.000000000000000000',
      expiry: null,
      obligationCreated: true,
      result: 'DISTRIBUTED',
    });
    expect(h.savedLedger[0].metadata).toMatchObject({
      bonusCategory: 'CASHBACK_BONUS',
      wageringRequired: true,
      wageringMultiplier: '3.000000000000000000',
    });
  });
});




