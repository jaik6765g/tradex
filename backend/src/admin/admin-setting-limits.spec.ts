import { AdminService } from './admin.service';
import { AdminSetting } from './entities/admin-setting.entity';
import {
  LIMIT_MIN_EXCEEDS_MAX_CODE,
  MISSING_REASON_CODE,
  MIN_DEPOSIT_USDT_KEY,
  MAX_DEPOSIT_USDT_KEY,
  MIN_WITHDRAWAL_USDT_KEY,
  MAX_WITHDRAWAL_USDT_KEY,
  MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
} from '../limits/limits.service';

// ============================================================
// Stubs — logs lock acquisition order to prove the atomic flow
// ============================================================

function makeHarness(
  settings: Record<
    string,
    {
      value: string;
      editable?: boolean;
      valueType?: 'number' | 'json' | 'string';
    }
  >,
) {
  const calls: string[] = [];
  const rows: Record<string, any> = {};

  for (const [key, cfg] of Object.entries(settings)) {
    rows[key] = {
      id: `id-${key}`,
      key,
      value: cfg.value,
      valueType: cfg.valueType ?? 'number',
      description: null,
      editable: cfg.editable ?? true,
      updatedBy: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
  }

  const repo: any = {
    findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
      calls.push(`preflight:${where.key}`);
      return rows[where.key] ?? null;
    }),
    createQueryBuilder: () => {
      let lockedKey = '';
      const qb: any = {
        setLock: () => qb,
        where: (_sql: string, params: { key: string }) => {
          lockedKey = params.key;
          calls.push(`lock:${params.key}`);
          return qb;
        },
        getMany: jest.fn(async () => {
          const row = rows[lockedKey];
          return row ? [row] : [];
        }),
      };
      return qb;
    },
    find: jest.fn(async ({ where }: { where: { key: string }[] }) =>
      where.map((w) => rows[w.key]).filter(Boolean),
    ),
    save: jest.fn(async (row: any) => {
      calls.push(`save:${row.key}`);
      rows[row.key] = row;
      return row;
    }),
  };

  const auditRepo: any = {
    create: (data: Record<string, unknown>) => data,
    save: jest.fn(async (row: Record<string, unknown>) => {
      calls.push('audit');
      return row;
    }),
  };

  const manager: any = {
    getRepository: jest.fn((entity: any) =>
      entity?.name === 'AdminSetting' ? repo : auditRepo,
    ),
  };

  const dataSource: any = {
    transaction: async (cb: (m: any) => Promise<unknown>) => cb(manager),
  };

  const service = new AdminService(auditRepo, repo, {} as any, dataSource);

  return { service, repo, auditRepo, calls, rows };
}

const CONTEXT = { adminId: 'admin-1', ipAddress: '1.2.3.4', userAgent: 'jest' };

// ============================================================
// Mandatory reason
// ============================================================

describe('AdminService.updateSetting — mandatory reason', () => {
  it('rejects a missing reason with 400 MISSING_REASON and writes nothing', async () => {
    const { service, repo, auditRepo } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
    });

    await expect(
      service.updateSetting(
        MIN_DEPOSIT_USDT_KEY,
        { value: '20', valueType: 'number' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: MISSING_REASON_CODE },
    });

    expect(repo.save).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only reason', async () => {
    const { service } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
    });

    await expect(
      service.updateSetting(
        MIN_DEPOSIT_USDT_KEY,
        { value: '20', valueType: 'number', reason: '   ' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ response: { code: MISSING_REASON_CODE } });
  });

  it('persists the reason in the audit row for a valid change', async () => {
    const { service, auditRepo } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
      [MAX_DEPOSIT_USDT_KEY]: { value: '10000' },
    });

    await service.updateSetting(
      MIN_DEPOSIT_USDT_KEY,
      { value: '20', valueType: 'number', reason: 'Raised floor' } as any,
      CONTEXT,
    );

    expect(auditRepo.save).toHaveBeenCalledTimes(1);
    const row = auditRepo.save.mock.calls[0][0];
    expect(row.action).toBe('ADMIN_SETTING_UPDATED');
    expect(row.metadata.reason).toBe('Raised floor');
    expect(row.oldValue.value).toBe('10');
    expect(row.newValue.value).toBe('20');
  });
});

// ============================================================
// Atomic min <= max invariant (Correction 3)
// ============================================================

describe('AdminService.updateSetting — atomic min/max validation', () => {
  it('locks BOTH rows of the pair before reading and validating', async () => {
    const { service, calls } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
      [MAX_DEPOSIT_USDT_KEY]: { value: '10000' },
    });

    await service.updateSetting(
      MIN_DEPOSIT_USDT_KEY,
      { value: '20', valueType: 'number', reason: 'raise floor' } as any,
      CONTEXT,
    );

    // Both pair rows are locked, in sorted (deadlock-free) order.
    const lockCalls = calls.filter((c) => c.startsWith('lock:'));
    expect(lockCalls).toEqual([
      `lock:${MAX_DEPOSIT_USDT_KEY}`,
      `lock:${MIN_DEPOSIT_USDT_KEY}`,
    ]);
  });

  it('rejects min > max with 400 LIMIT_MIN_EXCEEDS_MAX and writes nothing', async () => {
    const { service, repo, auditRepo } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
      [MAX_DEPOSIT_USDT_KEY]: { value: '10000' },
    });

    await expect(
      service.updateSetting(
        MIN_DEPOSIT_USDT_KEY,
        { value: '20000', valueType: 'number', reason: 'too high' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: LIMIT_MIN_EXCEEDS_MAX_CODE,
        min: '20000',
        max: '10000',
      },
    });

    // Atomicity: neither the setting nor the audit row is written.
    expect(repo.save).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('validates against the LATEST committed counterpart value under the lock', async () => {
    // max is 100 already (as lowered by a concurrent admin); raising min to
    // 150 must fail even though a stale preflight read said 10000.
    const { service, repo } = makeHarness({
      [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
      [MAX_DEPOSIT_USDT_KEY]: { value: '100' },
    });

    // Simulate a stale preflight snapshot for the max row.
    repo.findOne.mockImplementation(
      async ({ where }: { where: { key: string } }) => ({
        id: `id-${where.key}`,
        key: where.key,
        value: where.key === MAX_DEPOSIT_USDT_KEY ? '10000' : '10',
        valueType: 'number',
        description: null,
        editable: true,
        updatedBy: null,
      }),
    );

    await expect(
      service.updateSetting(
        MIN_DEPOSIT_USDT_KEY,
        { value: '150', valueType: 'number', reason: 'race' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ response: { code: LIMIT_MIN_EXCEEDS_MAX_CODE } });
  });

  it('accepts min == max (inclusive invariant)', async () => {
    const { service, repo } = makeHarness({
      [MIN_WITHDRAWAL_USDT_KEY]: { value: '5' },
      [MAX_WITHDRAWAL_USDT_KEY]: { value: '500' },
    });

    await service.updateSetting(
      MIN_WITHDRAWAL_USDT_KEY,
      { value: '500', valueType: 'number', reason: 'equal is allowed' } as any,
      CONTEXT,
    );

    expect(repo.save).toHaveBeenCalled();
  });

  it('applies the invariant when lowering the MAX side too', async () => {
    const { service, repo } = makeHarness({
      [MIN_WITHDRAWAL_USDT_KEY]: { value: '5' },
      [MAX_WITHDRAWAL_USDT_KEY]: { value: '500' },
    });

    await expect(
      service.updateSetting(
        MAX_WITHDRAWAL_USDT_KEY,
        { value: '1', valueType: 'number', reason: 'too low' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ response: { code: LIMIT_MIN_EXCEEDS_MAX_CODE } });

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects negative limit values', async () => {
    const { service } = makeHarness({
      [MIN_WITHDRAWAL_USDT_KEY]: { value: '5' },
      [MAX_WITHDRAWAL_USDT_KEY]: { value: '500' },
    });

    await expect(
      service.updateSetting(
        MAX_WITHDRAWAL_USDT_KEY,
        { value: '-1', valueType: 'number', reason: 'bad' } as any,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_SETTING_VALUE' } });
  });

  it('does not apply the min/max invariant to unrelated settings', async () => {
    const { service, repo } = makeHarness({ someOtherKey: { value: '1' } });

    await service.updateSetting(
      'someOtherKey',
      { value: '2', valueType: 'number', reason: 'unrelated' } as any,
      CONTEXT,
    );

    expect(repo.save).toHaveBeenCalled();
  });
  // ============================================================
  // WRITE-TIME KEY VALIDATION (pre-migration hardening)
  // ============================================================

  const LIMIT_KEYS = [
    MIN_DEPOSIT_USDT_KEY,
    MAX_DEPOSIT_USDT_KEY,
    MIN_WITHDRAWAL_USDT_KEY,
    MAX_WITHDRAWAL_USDT_KEY,
  ];

  describe('AdminService.updateSetting — numeric limit keys require valueType number', () => {
    it.each(LIMIT_KEYS)(
      'rejects a non-number valueType for %s with zero writes',
      async (key) => {
        const { service, repo, auditRepo } = makeHarness({
          [key]: { value: '10' },
        });

        for (const valueType of ['string', 'json', 'boolean'] as const) {
          await expect(
            service.updateSetting(
              key,
              { value: 'anything', valueType, reason: 'hardening test' } as any,
              CONTEXT,
            ),
          ).rejects.toMatchObject({
            status: 400,
            response: { code: 'INVALID_SETTING_VALUE' },
          });
        }

        expect(repo.save).not.toHaveBeenCalled();
        expect(auditRepo.save).not.toHaveBeenCalled();
      },
    );

    it('still accepts valueType number for a limit key', async () => {
      const { service } = makeHarness({
        [MIN_DEPOSIT_USDT_KEY]: { value: '10' },
        [MAX_DEPOSIT_USDT_KEY]: { value: '10000' },
      });

      const saved = await service.updateSetting(
        MIN_DEPOSIT_USDT_KEY,
        { value: '20', valueType: 'number', reason: 'ok' } as any,
        CONTEXT,
      );

      expect(saved.value).toBe('20');
    });

    it('defaults to the stored number valueType when valueType is omitted', async () => {
      const { service } = makeHarness({
        [MIN_WITHDRAWAL_USDT_KEY]: { value: '5', valueType: 'number' },
        [MAX_WITHDRAWAL_USDT_KEY]: { value: '500' },
      });

      const saved = await service.updateSetting(
        MIN_WITHDRAWAL_USDT_KEY,
        { value: '10', reason: 'omitted valueType is fine' },
        CONTEXT,
      );

      expect(saved.value).toBe('10');
    });
  });

  describe('AdminService.updateSetting — daily withdrawal frequency JSON validation', () => {
    it('accepts the canonical COUNT form and stores it verbatim as json', async () => {
      const { service } = makeHarness({
        [MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY]: {
          value: '{"mode":"COUNT","value":3}',
          valueType: 'json',
        },
      });

      const saved = await service.updateSetting(
        MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
        {
          value: '{"mode":"COUNT","value":5}',
          reason: 'raising to 5 per day',
        },
        CONTEXT,
      );

      expect(saved.value).toBe('{"mode":"COUNT","value":5}');
      expect(saved.valueType).toBe('json');
    });

    it('accepts the canonical UNLIMITED form', async () => {
      const { service } = makeHarness({
        [MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY]: {
          value: '{"mode":"COUNT","value":3}',
          valueType: 'json',
        },
      });

      const saved = await service.updateSetting(
        MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
        { value: '{"mode":"UNLIMITED"}', reason: 'promo day' },
        CONTEXT,
      );

      expect(saved.value).toBe('{"mode":"UNLIMITED"}');
      expect(saved.valueType).toBe('json');
    });

    it('is backward compatible: legacy numeric input becomes canonical COUNT json', async () => {
      const { service } = makeHarness({
        [MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY]: { value: '3' },
      });

      const saved = await service.updateSetting(
        MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
        { value: '10', reason: 'legacy admin still sending 10' },
        CONTEXT,
      );

      expect(saved.value).toBe('{"mode":"COUNT","value":10}');
      expect(saved.valueType).toBe('json');
    });

    it('maps legacy 0 (check disabled) to UNLIMITED', async () => {
      const { service } = makeHarness({
        [MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY]: { value: '0' },
      });

      const saved = await service.updateSetting(
        MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
        { value: '0', reason: 'legacy disabled semantics' },
        CONTEXT,
      );

      expect(saved.value).toBe('{"mode":"UNLIMITED"}');
    });

    it.each([
      ['{"mode":"BOGUS"}', 'invalid mode'],
      ['{"mode":"COUNT","value":0}', 'zero value'],
      ['{"mode":"COUNT","value":-1}', 'negative value'],
      ['{"mode":"COUNT","value":2.5}', 'float value'],
      ['{"mode":"COUNT","value":"3"}', 'string value'],
      ['{"mode":"UNLIMITED","value":5}', 'UNLIMITED with extra field'],
      ['{"mode":"COUNT"}', 'COUNT without value'],
      ['{"mode":"COUNT","value":3,"extra":1}', 'COUNT with extra field'],
      ['not json at all', 'malformed JSON'],
      ['[]', 'JSON array'],
      ['null', 'JSON null'],
      ['""', 'empty string'],
      ['abc', 'non-numeric legacy text'],
    ])(
      'rejects %j (%s) with INVALID_SETTING_VALUE and zero writes',
      async (value) => {
        const { service, repo, auditRepo } = makeHarness({
          [MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY]: {
            value: '{"mode":"COUNT","value":3}',
            valueType: 'json',
          },
        });

        await expect(
          service.updateSetting(
            MAX_WITHDRAWALS_PER_USER_PER_DAY_KEY,
            { value, reason: 'should be rejected' } as any,
            CONTEXT,
          ),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: 'INVALID_SETTING_VALUE' },
        });

        expect(repo.save).not.toHaveBeenCalled();
        expect(auditRepo.save).not.toHaveBeenCalled();
      },
    );
  });
});
