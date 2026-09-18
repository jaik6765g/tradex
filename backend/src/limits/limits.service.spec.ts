import Decimal from 'decimal.js';

import {
  DEFAULT_MAX_DEPOSIT_USDT,
  DEFAULT_MAX_WITHDRAWAL_USDT,
  DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY,
  DEFAULT_MIN_DEPOSIT_USDT,
  DEFAULT_MIN_WITHDRAWAL_USDT,
  DEPOSIT_ABOVE_MAXIMUM_CODE,
  DEPOSIT_BELOW_MINIMUM_CODE,
  WITHDRAWAL_ABOVE_MAXIMUM_CODE,
  WITHDRAWAL_BELOW_MINIMUM_CODE,
  getIstDayWindow,
  parseDailyWithdrawalFrequency,
  LimitsService,
} from './limits.service';
import type { AdminSetting } from '../admin/entities/admin-setting.entity';

// ============================================================
// Admin settings repository stub — values read fresh from the "DB"
// ============================================================

function makeService(settings: Record<string, string> = {}) {
  const repo = {
    findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
      const value = settings[where.key];
      return value === undefined ? null : ({ key: where.key, value } as AdminSetting);
    }),
  };

  const service = new LimitsService(repo as any);
  return { service, repo };
}

describe('LimitsService — defaults, reads and Decimal.js validation', () => {
  it('falls back to the approved defaults when rows are missing', async () => {
    const { service } = makeService({});

    const deposit = await service.getDepositLimits();
    const withdrawal = await service.getWithdrawalLimits();
    const frequency = await service.getDailyWithdrawalFrequency();

    expect(new Decimal(deposit.minUsdt).toString()).toBe(DEFAULT_MIN_DEPOSIT_USDT);
    expect(new Decimal(deposit.maxUsdt).toString()).toBe(DEFAULT_MAX_DEPOSIT_USDT);
    expect(new Decimal(withdrawal.minUsdt).toString()).toBe(
      DEFAULT_MIN_WITHDRAWAL_USDT,
    );
    expect(new Decimal(withdrawal.maxUsdt).toString()).toBe(
      DEFAULT_MAX_WITHDRAWAL_USDT,
    );
    expect(frequency).toEqual({
      mode: 'COUNT',
      value: DEFAULT_MAX_WITHDRAWALS_PER_USER_PER_DAY,
    });
  });

  it('reads administrator-configured values (no cache — DB authoritative)', async () => {
    const { service, repo } = makeService({
      minDepositUsdt: '25',
      maxDepositUsdt: '9000',
    });

    const first = await service.getDepositLimits();
    expect(new Decimal(first.minUsdt).toString()).toBe('25');

    // Change the "DB" and read again — the second read must see the new value
    // (proves there is no 30s in-process cache on the enforcement path).
    repo.findOne.mockImplementation((async ({ where }: { where: { key: string } }) => ({
      key: where.key,
      value: where.key === 'minDepositUsdt' ? '30' : '9000',
    })) as any);

    const second = await service.getDepositLimits();
    expect(new Decimal(second.minUsdt).toString()).toBe('30');
  });

  it('DEPOSIT: rejects below 10 and above 10,000; accepts exact boundaries', async () => {
    const { service } = makeService({
      minDepositUsdt: '10',
      maxDepositUsdt: '10000',
    });

    await expect(service.assertDepositAmount('9.99')).rejects.toMatchObject({
      status: 400,
      response: { code: DEPOSIT_BELOW_MINIMUM_CODE },
    });
    await expect(service.assertDepositAmount('10000.000000000000000001')).rejects.toMatchObject(
      { status: 400, response: { code: DEPOSIT_ABOVE_MAXIMUM_CODE } },
    );

    // Exact inclusive boundaries must pass (no float drift).
    await expect(service.assertDepositAmount('10')).resolves.toBeInstanceOf(Decimal);
    await expect(service.assertDepositAmount('10000')).resolves.toBeInstanceOf(
      Decimal,
    );
  });

  it('WITHDRAWAL: rejects below 5 and above 500; accepts exact boundaries', async () => {
    const { service } = makeService({
      minWithdrawalUsdt: '5',
      maxWithdrawalUsdt: '500',
    });

    await expect(service.assertWithdrawalAmount('4.999999999999999999')).rejects.toMatchObject(
      { status: 400, response: { code: WITHDRAWAL_BELOW_MINIMUM_CODE } },
    );
    await expect(service.assertWithdrawalAmount('500.000000000000000001')).rejects.toMatchObject(
      { status: 400, response: { code: WITHDRAWAL_ABOVE_MAXIMUM_CODE } },
    );

    await expect(service.assertWithdrawalAmount('5')).resolves.toBeInstanceOf(Decimal);
    await expect(service.assertWithdrawalAmount('500')).resolves.toBeInstanceOf(Decimal);
  });

  it('rejects non-positive / non-finite amounts as INVALID_AMOUNT', async () => {
    const { service } = makeService({});

    await expect(service.assertDepositAmount('0')).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_AMOUNT' },
    });
    await expect(service.assertWithdrawalAmount('-5')).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_AMOUNT' },
    });
    await expect(service.assertWithdrawalAmount('abc')).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_AMOUNT' },
    });
  });

  it('uses exact Decimal.js arithmetic for 18-decimal amounts', async () => {
    const { service } = makeService({
      minDepositUsdt: '0.000000000000000001',
      maxDepositUsdt: '10',
    });

    // 1 wei of an 18-decimal unit is exactly the minimum — must pass.
    await expect(
      service.assertDepositAmount('0.000000000000000001'),
    ).resolves.toBeInstanceOf(Decimal);

    // 1 wei below the minimum must fail (impossible in float math).
    await expect(
      service.assertDepositAmount('0.0000000000000000005'),
    ).rejects.toMatchObject({ response: { code: DEPOSIT_BELOW_MINIMUM_CODE } });
  });
});