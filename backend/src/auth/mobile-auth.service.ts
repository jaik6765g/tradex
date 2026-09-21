import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_ADMIN_CLIENT } from '../supabase/supabase.module';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { User } from '../users/user.entity';

import {
  ClaimWalletDto,
  ForgotPasswordDto,
  LinkWalletDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/mobile-auth.dto';

const MOBILE_REGEX = /^\+[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Withdrawals are paid out on BNB Smart Chain (BEP-20) only, so a wallet
 * linked on any other chain could never be used as a payout destination.
 */
const PAYOUT_CHAIN_ID = 56;

interface SupabaseIdentity {
  authUserId: string;
  email: string;
  mobileNumber: string | null;
}

interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

@Injectable()
export class MobileAuthService {
  private readonly forgotWindowMs = 15 * 60 * 1000;
  private readonly forgotMaxAttempts = 5;
  private readonly forgotAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT)
    private readonly supabase: SupabaseClient,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly configService: ConfigService,
  ) {}

  // ============================================================
  // SIGNUP — mobile + email + password (+ referral). No OTP.
  // ============================================================
  async signup(dto: SignupDto) {
    const mobile = this.normalizeMobile(dto.mobileNumber);
    const email = this.normalizeEmail(dto.email);

    const byMobile = await this.usersService.findByMobileNumber(mobile);
    if (byMobile) {
      throw new BadRequestException('Mobile number is already registered');
    }

    const byEmail = await this.usersService.findByEmail(email);
    if (byEmail) {
      throw new BadRequestException('Email is already registered');
    }

    // Create the Supabase identity (email/password). No confirmation email.
    const { data: created, error: createError } =
      await this.supabase.auth.admin.createUser({
        email,
        password: dto.password,
        email_confirm: true,
        user_metadata: { mobileNumber: mobile },
      });

    if (createError || !created?.user?.id) {
      if (createError?.message?.toLowerCase().includes('already')) {
        throw new BadRequestException('Email is already registered');
      }
      throw new BadRequestException('Unable to create account');
    }

    const authUserId = created.user.id;

    let user: User;
    try {
      user = await this.usersService.createWithMobileReferral({
        authUserId,
        mobileNumber: mobile,
        email,
        referralCode: dto.referralCode,
      });
    } catch (err) {
      // Best-effort rollback so a failed TradeX record doesn't orphan Supabase.
      await this.supabase.auth.admin
        .deleteUser(authUserId)
        .catch(() => undefined);
      throw err;
    }

    const session = await this.trySignIn(email, dto.password);

    return {
      access_token: session?.access_token ?? null,
      refresh_token: session?.refresh_token ?? null,
      ...this.buildAuthResponse(user),
    };
  }

  // ============================================================
  // LOGIN — mobile + password. Email resolved internally.
  // ============================================================
  async login(dto: LoginDto) {
    const mobile = this.normalizeMobile(dto.mobileNumber);

    const user = await this.usersService.findByMobileNumber(mobile);

    if (!user?.email || !user.authUserId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const session = await this.trySignIn(user.email, dto.password);

    if (!session) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      ...this.buildAuthResponse(user),
    };
  }

  // ============================================================
  // FORGOT PASSWORD — resolve email internally, send Supabase email OTP.
  // ============================================================
  async forgotPassword(dto: ForgotPasswordDto, ipAddress: string) {
    const mobile = this.normalizeMobile(dto.mobileNumber);
    const allowed = this.consumeForgotRateLimit(mobile, ipAddress);

    if (allowed) {
      const user = await this.usersService.findByMobileNumber(mobile);

      if (user?.email) {
        await this.supabase.auth
          .signInWithOtp({
            email: user.email,
            options: { shouldCreateUser: false },
          })
          .catch(() => undefined);
      }
    }

    return {
      message:
        'If the account exists, password reset instructions have been sent.',
    };
  }

  // ============================================================
  // RESET PASSWORD — verify email OTP server-side, then set password.
  // ============================================================
  async resetPassword(dto: ResetPasswordDto) {
    const mobile = this.normalizeMobile(dto.mobileNumber);

    const user = await this.usersService.findByMobileNumber(mobile);

    if (!user?.email || !user.authUserId) {
      throw new BadRequestException('Invalid or expired code');
    }

    const { error: verifyError } = await this.supabase.auth.verifyOtp({
      email: user.email,
      token: dto.token,
      type: 'email',
    });

    if (verifyError) {
      throw new BadRequestException('Invalid or expired code');
    }

    const { error: updateError } =
      await this.supabase.auth.admin.updateUserById(user.authUserId, {
        password: dto.password,
      });

    if (updateError) {
      throw new BadRequestException(
        updateError.message || 'Unable to reset password',
      );
    }

    return { message: 'Password reset successfully' };
  }

  // ============================================================
  // ME
  // ============================================================
  async me(authUserId: string) {
    const user = await this.usersService.findByAuthUserId(authUserId);

    if (!user) {
      throw new UnauthorizedException('Account not found');
    }

    return this.buildAuthResponse(user);
  }
  // ============================================================
  // LEGACY WALLET CLAIM (migration helper — NOT a login).
  // ============================================================
  async claimWallet(dto: ClaimWalletDto) {
    const address = this.verifyWalletOwnership(
      dto.walletAddress,
      dto.signature,
      dto.message,
    );
    this.assertSupportedChain(dto.chainId);

    const { authUserId, email, mobileNumber } =
      await this.resolveSupabaseIdentity(dto.accessToken);
    const mobile = this.normalizeMobile(mobileNumber);

    let userId: string;

    const byUser = await this.usersService.findByAddress(address);
    if (byUser) {
      userId = byUser.id;
    } else {
      const wallet = await this.walletsService.findByAddress(address);
      if (!wallet) {
        throw new BadRequestException(
          'No TradeX account is associated with this wallet',
        );
      }
      userId = wallet.userId;
    }

    const user = await this.usersService.attachMobileAuth(
      userId,
      authUserId,
      mobile,
      email,
    );

    return this.buildAuthResponse(user);
  }

  // ============================================================
  // LINK WALLET (post-login crypto feature, NOT login).
  // ============================================================
  async linkWallet(userId: string, dto: LinkWalletDto) {
    const address = this.verifyWalletOwnership(
      dto.walletAddress,
      dto.signature,
      dto.message,
    );
    this.assertSupportedChain(dto.chainId);
    // Payout destinations must be on the chain the platform actually pays on
    // (BSC/56). assertSupportedChain keeps its existing wider policy.
    this.assertPayoutChain(dto.chainId);

    const wallet = await this.walletsService.findOrCreate(
      userId,
      address,
      dto.chainId,
    );

    return {
      id: wallet.id,
      address: wallet.address,
      chainId: wallet.chainId,
      isPrimary: wallet.isPrimary,
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private async trySignIn(
    email: string,
    password: string,
  ): Promise<SessionTokens | null> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return null;
    }

    return data.session ?? null;
  }

  private async resolveSupabaseIdentity(
    accessToken: string,
  ): Promise<SupabaseIdentity> {
    const { data, error } = await this.supabase.auth.getUser(accessToken);

    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const mobileNumber =
      typeof meta.mobileNumber === 'string' ? meta.mobileNumber : null;

    return {
      authUserId: data.user.id,
      email: this.normalizeEmail(data.user.email ?? ''),
      mobileNumber,
    };
  }

  private normalizeMobile(phone: string | null): string {
    if (!phone) {
      throw new BadRequestException('Mobile number is required');
    }

    const trimmed = phone.trim();
    const normalized = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;

    if (!MOBILE_REGEX.test(normalized)) {
      throw new BadRequestException('Invalid mobile number');
    }

    return normalized;
  }

  private normalizeEmail(email: string): string {
    const normalized = email?.trim().toLowerCase();

    if (!normalized || !EMAIL_REGEX.test(normalized)) {
      throw new BadRequestException('Invalid email address');
    }

    return normalized;
  }

  private consumeForgotRateLimit(mobile: string, ipAddress: string): boolean {
    const now = Date.now();
    const keys = [`mobile:${mobile}`, `ip:${ipAddress ?? 'unknown'}`];

    for (const key of keys) {
      const entry = this.forgotAttempts.get(key);
      if (entry && now < entry.resetAt && entry.count >= this.forgotMaxAttempts) {
        return false;
      }
    }

    for (const key of keys) {
      const entry = this.forgotAttempts.get(key);
      if (!entry || now >= entry.resetAt) {
        this.forgotAttempts.set(key, {
          count: 1,
          resetAt: now + this.forgotWindowMs,
        });
      } else {
        this.forgotAttempts.set(key, {
          count: entry.count + 1,
          resetAt: entry.resetAt,
        });
      }
    }

    return true;
  }

  private verifyWalletOwnership(
    walletAddress: string,
    signature: string,
    message: string,
  ): string {
    let address: string;

    try {
      address = ethers.getAddress(walletAddress);
    } catch {
      throw new BadRequestException('Invalid wallet address');
    }

    let recovered: string;

    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      throw new BadRequestException('Invalid signature');
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      throw new BadRequestException('Signature does not match wallet address');
    }

    const referencesAddress =
      message.includes(address) || message.includes(address.toLowerCase());

    if (!referencesAddress) {
      throw new BadRequestException('Message does not reference the wallet');
    }

    return address;
  }

  private assertSupportedChain(chainId: number): void {
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') || 'development';
    const baseChains = [56, 137];
    const supported =
      nodeEnv === 'development' || nodeEnv === 'test'
        ? [...baseChains, 97]
        : baseChains;

    if (!supported.includes(Number(chainId))) {
      throw new BadRequestException('Unsupported blockchain network');
    }
  }

  /**
   * Wallet LINKING is payout-oriented: only BSC mainnet wallets can ever be
   * used as a withdrawal destination, so linking is restricted to chain 56.
   * The wider supported-chain policy (56/137, +97 in dev/test) is deliberately
   * left untouched.
   */
  private assertPayoutChain(chainId: number): void {
    if (Number(chainId) !== PAYOUT_CHAIN_ID) {
      throw new BadRequestException(
        `Only BNB Smart Chain (chain ID ${PAYOUT_CHAIN_ID}) wallets can be linked for withdrawals`,
      );
    }
  }

  private resolveRole(user: User): 'admin' | 'user' {
    if (user.role === 'admin') {
      return 'admin';
    }

    const adminWallet = this.configService.get<string>('ADMIN_WALLET');

    if (adminWallet && user.walletAddress) {
      try {
        if (user.walletAddress.toLowerCase() === adminWallet.toLowerCase()) {
          return 'admin';
        }
      } catch {
        // ignore
      }
    }

    return 'user';
  }

  private buildAuthResponse(user: User) {
    return {
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        email: user.email,
        walletAddress: user.walletAddress,
        role: this.resolveRole(user),
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }
}
