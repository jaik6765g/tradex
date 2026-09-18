import { BadRequestException } from '@nestjs/common';

import { UsersService } from './users.service';
import { User } from './user.entity';

// ============================================================
// Referral signup flow — backend authority
//
// Covers the referral-link requirements on the server side: the code must be
// validated, self-referral refused, retries must never create a second
// relationship, and signup must never touch money.
// ============================================================

const AUTH_USER_ID = 'aaaaaaaa-0000-1111-2222-333333333333';
const MOBILE = '+919876543210';
const EMAIL = 'invitee@example.com';
const REFERRER_ID = 'bbbbbbbb-0000-1111-2222-333333333333';

function makeReferrer(overrides: Partial<User> = {}): User {
  return {
    id: REFERRER_ID,
    referralCode: 'TDX12345',
    email: 'referrer@example.com',
    mobileNumber: '+919000000000',
    walletAddress: '0x2222222222222222222222222222222222222222',
    ...overrides,
  } as unknown as User;
}

function makeHarness(
  options: {
    byAuth?: User | null;
    byMobile?: User | null;
    byEmail?: User | null;
    /** Row returned for the referralCode lookup. */
    referrer?: User | null;
    /** Wallet row returned by createWithReferral's address lookup. */
    byWallet?: User | null;
    nextSequence?: string;
  } = {},
) {
  // Distinguishes which lookup the service is performing so each can be
  // answered independently (auth / mobile / email / referral / wallet).
  const findOne = jest.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if ('authUserId' in where) return options.byAuth ?? null;
    if ('mobileNumber' in where) return options.byMobile ?? null;
    if ('email' in where) return options.byEmail ?? null;
    if ('referralCode' in where) return options.referrer ?? null;
    if ('walletAddress' in where) return options.byWallet ?? null;
    return null;
  });

  const save = jest.fn(async (row: Record<string, unknown>) => ({
    id: 'new-user-id',
    ...row,
  }));

  const userRepository: any = {
    findOne,
    create: (data: Record<string, unknown>) => ({ ...data }),
    save,
  };

  const manager: any = {
    getRepository: jest.fn(() => userRepository),
    query: jest.fn(async () => [{ nextValue: options.nextSequence ?? '42' }]),
  };

  userRepository.manager = {
    transaction: async (cb: (m: unknown) => Promise<unknown>) => cb(manager),
  };

  const configService: any = {
    get: jest.fn(() => 'https://tradex.example'),
  };

  const service = new UsersService(userRepository, configService);

  return { service, userRepository, manager, save, findOne };
}

// ============================================================
// Mobile / email signup (the path used by POST /auth/signup)
// ============================================================

describe('UsersService — referral signup (createWithMobileReferral)', () => {
  it('applies the referral relationship for a valid code after the user is created', async () => {
    const { service, save, findOne } = makeHarness({
      referrer: makeReferrer(),
    });

    const user = await service.createWithMobileReferral({
      authUserId: AUTH_USER_ID,
      mobileNumber: MOBILE,
      email: EMAIL,
      referralCode: 'TDX12345',
    });

    // Referrer resolved strictly by the submitted code.
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referralCode: 'TDX12345' } }),
    );

    // Relationship applied on the created row, not before it.
    expect(user.referredBy).toBe(REFERRER_ID);
    // The invitee still gets their own fresh code.
    expect(user.referralCode).toBe('TDX42');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('normalizes the submitted code (trim + upper-case) before lookup', async () => {
    const { service, findOne } = makeHarness({ referrer: makeReferrer() });

    await service.createWithMobileReferral({
      authUserId: AUTH_USER_ID,
      mobileNumber: MOBILE,
      email: EMAIL,
      referralCode: '  tdx12345  ',
    });

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referralCode: 'TDX12345' } }),
    );
  });

  it('rejects an unknown referral code and creates no user', async () => {
    const { service, save } = makeHarness({ referrer: null });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'NOPE999',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(save).not.toHaveBeenCalled();
  });

  it('refuses self-referral when the code belongs to the same email', async () => {
    const { service, save } = makeHarness({
      referrer: makeReferrer({ email: EMAIL.toUpperCase() }),
    });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'TDX12345',
      }),
    ).rejects.toThrow('Self-referral is not allowed');

    expect(save).not.toHaveBeenCalled();
  });

  it('refuses self-referral when the code belongs to the same mobile number', async () => {
    const { service, save } = makeHarness({
      referrer: makeReferrer({ mobileNumber: MOBILE }),
    });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'TDX12345',
      }),
    ).rejects.toThrow('Self-referral is not allowed');

    expect(save).not.toHaveBeenCalled();
  });

  it('signs up normally without any referral code (no relationship)', async () => {
    const { service, findOne } = makeHarness();

    const user = await service.createWithMobileReferral({
      authUserId: AUTH_USER_ID,
      mobileNumber: MOBILE,
      email: EMAIL,
    });

    expect(user.referredBy).toBeNull();
    expect(user.referralCode).toBe('TDX42');
    // No referral lookup is attempted when no code is supplied.
    expect(findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { referralCode: expect.anything() } }),
    );
  });

  it('treats a blank/whitespace code as "no referral" instead of failing', async () => {
    const { service } = makeHarness();

    const user = await service.createWithMobileReferral({
      authUserId: AUTH_USER_ID,
      mobileNumber: MOBILE,
      email: EMAIL,
      referralCode: '   ',
    });

    expect(user.referredBy).toBeNull();
  });

  it('a retried signup cannot create a second relationship', async () => {
    // The first attempt already created a user for this identity.
    const { service, save } = makeHarness({
      byAuth: { id: 'existing-user' } as User,
    });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'TDX12345',
      }),
    ).rejects.toThrow('Account is already registered');

    expect(save).not.toHaveBeenCalled();
  });

  it('a duplicate mobile number is rejected before any relationship is written', async () => {
    const { service, save } = makeHarness({
      byMobile: { id: 'existing-user' } as User,
    });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'TDX12345',
      }),
    ).rejects.toThrow('Mobile number is already registered');

    expect(save).not.toHaveBeenCalled();
  });

  it('a duplicate email is rejected before any relationship is written', async () => {
    const { service, save } = makeHarness({
      byEmail: { id: 'existing-user' } as User,
    });

    await expect(
      service.createWithMobileReferral({
        authUserId: AUTH_USER_ID,
        mobileNumber: MOBILE,
        email: EMAIL,
        referralCode: 'TDX12345',
      }),
    ).rejects.toThrow('Email is already registered');

    expect(save).not.toHaveBeenCalled();
  });

  it('creates the relationship without any financial side effect', async () => {
    const { service, manager, save } = makeHarness({
      referrer: makeReferrer(),
    });

    const user = await service.createWithMobileReferral({
      authUserId: AUTH_USER_ID,
      mobileNumber: MOBILE,
      email: EMAIL,
      referralCode: 'TDX12345',
    });

    // Only the users table is touched — no balances/ledger/commission entity
    // repository is ever requested during signup, so opening a referral link
    // or creating an account cannot award anything.
    expect(manager.getRepository).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).toHaveBeenCalledWith(User);

    const persisted = save.mock.calls[0][0];
    expect(Object.keys(persisted)).not.toContain('availableBalance');
    expect(Object.keys(persisted)).not.toContain('commission');
    expect(user.referredBy).toBe(REFERRER_ID);
  });
});

// ============================================================
// Wallet signup path — pre-existing hierarchy rules stay intact
// ============================================================

describe('UsersService — referral signup (createWithReferral)', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';

  it('applies a valid referral code to the new wallet user', async () => {
    const { service } = makeHarness({ referrer: makeReferrer() });

    const user = await service.createWithReferral(WALLET, 'tdx12345');

    expect(user.referredBy).toBe(REFERRER_ID);
    expect(user.status).toBe('active');
  });

  it('rejects an invalid referral code', async () => {
    const { service, save } = makeHarness({ referrer: null });

    await expect(
      service.createWithReferral(WALLET, 'NOPE999'),
    ).rejects.toThrow('Invalid referral code');

    expect(save).not.toHaveBeenCalled();
  });

  it('rejects self-referral on the same wallet address', async () => {
    const { service, save } = makeHarness({
      referrer: makeReferrer({ walletAddress: WALLET }),
    });

    await expect(
      service.createWithReferral(WALLET, 'TDX12345'),
    ).rejects.toThrow('Self-referral is not allowed');

    expect(save).not.toHaveBeenCalled();
  });

  it('returns the existing user unchanged (idempotent — no duplicate relationship)', async () => {
    const existing = { id: 'existing-user', walletAddress: WALLET } as User;
    const { service, save } = makeHarness({ byWallet: existing });

    const user = await service.createWithReferral(WALLET, 'TDX12345');

    expect(user).toBe(existing);
    expect(save).not.toHaveBeenCalled();
  });
});
