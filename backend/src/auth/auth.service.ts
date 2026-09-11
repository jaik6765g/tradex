import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { randomBytes } from 'crypto';

import { AuthNonce } from './auth-nonce.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';

interface RegistrationPayload {
  type: 'registration';
  walletAddress: string;
  chainId: number;
  referralCode?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AuthNonce)
    private readonly nonceRepository: Repository<AuthNonce>,

    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ============================================================
  // CREATE NONCE
  // ============================================================

  async createNonce(walletAddress: string) {
    const address = ethers.getAddress(walletAddress);

    // Invalidate all previous unused nonces
    await this.nonceRepository.update(
      {
        walletAddress: address,
        used: false,
      },
      {
        used: true,
      },
    );

    const nonce = randomBytes(32).toString('hex');

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const record = this.nonceRepository.create({
      walletAddress: address,
      nonce,
      expiresAt,
      used: false,
    });

    await this.nonceRepository.save(record);

    return {
      walletAddress: address,
      nonce,
      expiresAt,
      message: this.buildMessage(address, nonce),
    };
  }

  // ============================================================
  // VERIFY SIGNATURE
  //
  // Existing wallet:
  //     -> Login
  //
  // New wallet:
  //     -> Return registration token
  //     -> DO NOT create user
  // ============================================================

  async verifySignature(
    walletAddress: string,
    signature: string,
    nonce: string,
    chainId: number,
    referralCode?: string,
  ) {
    // ----------------------------------------------------------
    // 1. Validate blockchain network
    // ----------------------------------------------------------

    const supportedChains = this.getSupportedChains();

    if (!supportedChains.includes(chainId)) {
      throw new BadRequestException('Unsupported blockchain network');
    }

    // ----------------------------------------------------------
    // 2. Normalize wallet address
    // ----------------------------------------------------------

    let address: string;

    try {
      address = ethers.getAddress(walletAddress);
    } catch {
      throw new BadRequestException('Invalid wallet address');
    }

    // ----------------------------------------------------------
    // 3. Find valid nonce
    // ----------------------------------------------------------

    const record = await this.nonceRepository.findOne({
      where: {
        walletAddress: address,
        nonce,
        used: false,
      },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid or already used nonce');
    }

    // ----------------------------------------------------------
    // 4. Check nonce expiration
    // ----------------------------------------------------------

    if (record.expiresAt.getTime() < Date.now()) {
      record.used = true;

      await this.nonceRepository.save(record);

      throw new UnauthorizedException('Nonce expired');
    }

    // ----------------------------------------------------------
    // 5. Build authentication message
    // ----------------------------------------------------------

    const message = this.buildMessage(address, nonce);

    // ----------------------------------------------------------
    // 6. Verify signature
    // ----------------------------------------------------------

    let recoveredAddress: string;

    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    // ----------------------------------------------------------
    // 7. Make sure signature belongs to wallet
    // ----------------------------------------------------------

    try {
      if (ethers.getAddress(recoveredAddress) !== address) {
        throw new UnauthorizedException('Signature does not match wallet');
      }
    } catch {
      throw new UnauthorizedException('Signature does not match wallet');
    }

    // ----------------------------------------------------------
    // 8. Mark nonce as used
    // ----------------------------------------------------------

    record.used = true;

    await this.nonceRepository.save(record);

    // ----------------------------------------------------------
    // 9. Check existing user
    // ----------------------------------------------------------

    const user = await this.usersService.findByAddress(address);

    // ==========================================================
    // EXISTING USER
    // ==========================================================

    if (user) {
      // IMPORTANT:
      // Existing user's referral relationship
      // is NEVER modified during login.

      const wallet = await this.walletsService.findOrCreate(
        user.id,
        address,
        chainId,
      );

      // --------------------------------------------------------
      // Generate login JWT
      // --------------------------------------------------------

      const accessToken = await this.jwtService.signAsync({
        sub: user.id,
        walletAddress: address,
        walletId: wallet.id,
        chainId,
        referralCode: user.referralCode,
      });

      return {
        registered: true,
        registrationRequired: false,
        accessToken,

        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          role: this.resolveRole(user.walletAddress),
          referralCode: user.referralCode,
          referredBy: user.referredBy,
          status: user.status,
          createdAt: user.createdAt,
        },

        wallet: {
          id: wallet.id,
          address: wallet.address,
          chainId: wallet.chainId,
        },
      };
    }

    // ==========================================================
    // NEW USER
    // ==========================================================

    // DO NOT CREATE USER HERE.

    // Create a short-lived registration token.
    // This proves that the wallet successfully completed
    // the signature verification above.

    const normalizedReferralCode = this.normalizeReferralCode(referralCode);

    const registrationToken = await this.jwtService.signAsync(
      {
        type: 'registration',
        walletAddress: address,
        chainId,
        ...(normalizedReferralCode
          ? {
              referralCode: normalizedReferralCode,
            }
          : {}),
      } satisfies RegistrationPayload,
      {
        expiresIn: '10m',
      },
    );

    return {
      registered: false,
      registrationRequired: true,

      walletAddress: address,
      chainId,

      registrationToken,
    };
  }

  // ============================================================
  // REGISTER NEW USER
  // ============================================================

  async registerUser(
    walletAddress: string,
    registrationToken: string,
    chainId: number,
    referralCode?: string,
  ) {
    // ----------------------------------------------------------
    // 1. Validate registration token
    // ----------------------------------------------------------

    let payload: RegistrationPayload;

    try {
      payload =
        await this.jwtService.verifyAsync<RegistrationPayload>(
          registrationToken,
        );
    } catch {
      throw new UnauthorizedException('Invalid or expired registration token');
    }

    // ----------------------------------------------------------
    // 2. Check token type
    // ----------------------------------------------------------

    if (payload.type !== 'registration') {
      throw new UnauthorizedException('Invalid registration token');
    }

    // ----------------------------------------------------------
    // 3. Normalize wallet address
    // ----------------------------------------------------------

    let address: string;

    try {
      address = ethers.getAddress(walletAddress);
    } catch {
      throw new BadRequestException('Invalid wallet address');
    }

    // ----------------------------------------------------------
    // 4. Make sure token belongs to same wallet
    // ----------------------------------------------------------

    if (ethers.getAddress(payload.walletAddress) !== address) {
      throw new UnauthorizedException(
        'Registration token does not belong to wallet',
      );
    }

    // ----------------------------------------------------------
    // 5. Make sure token chain matches request
    // ----------------------------------------------------------

    if (payload.chainId !== chainId) {
      throw new BadRequestException('Registration chain mismatch');
    }

    // ----------------------------------------------------------
    // 6. Validate supported chain
    // ----------------------------------------------------------

    const supportedChains = this.getSupportedChains();

    if (!supportedChains.includes(chainId)) {
      throw new BadRequestException('Unsupported blockchain network');
    }

    // ----------------------------------------------------------
    // 7. Make sure wallet is still unregistered
    // ----------------------------------------------------------

    const existing = await this.usersService.findByAddress(address);

    if (existing) {
      // If another registration already created it,
      // simply login the existing account.

      const wallet = await this.walletsService.findOrCreate(
        existing.id,
        address,
        chainId,
      );

      const accessToken = await this.jwtService.signAsync({
        sub: existing.id,
        walletAddress: address,
        walletId: wallet.id,
        chainId,
        referralCode: existing.referralCode,
      });

      return {
        registered: true,
        registrationRequired: false,
        accessToken,

        user: {
          id: existing.id,
          walletAddress: existing.walletAddress,
          role: this.resolveRole(existing.walletAddress),
          referralCode: existing.referralCode,
          referredBy: existing.referredBy,
          status: existing.status,
          createdAt: existing.createdAt,
        },

        wallet: {
          id: wallet.id,
          address: wallet.address,
          chainId: wallet.chainId,
        },
      };
    }

    // ----------------------------------------------------------
    // 8. Normalize referral code
    // ----------------------------------------------------------

    const normalizedReferralCode =
      this.normalizeReferralCode(referralCode) ??
      this.normalizeReferralCode(payload.referralCode);

    // ----------------------------------------------------------
    // 9. Create user
    //
    // createWithReferral() handles:
    //
    // - referral validation
    // - referrer lookup
    // - self referral protection
    // - referredBy = referrer UUID
    // - own referral code generation
    // ----------------------------------------------------------

    const user = await this.usersService.createWithReferral(
      address,
      normalizedReferralCode,
    );

    // ----------------------------------------------------------
    // 10. Create blockchain wallet record
    // ----------------------------------------------------------

    const wallet = await this.walletsService.findOrCreate(
      user.id,
      address,
      chainId,
    );

    // ----------------------------------------------------------
    // 11. Generate JWT
    // ----------------------------------------------------------

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      walletAddress: address,
      walletId: wallet.id,
      chainId,
      referralCode: user.referralCode,
    });

    // ----------------------------------------------------------
    // 12. Return complete registration response
    // ----------------------------------------------------------

    return {
      registered: true,
      registrationRequired: false,
      accessToken,

      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        role: this.resolveRole(user.walletAddress),
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        status: user.status,
        createdAt: user.createdAt,
      },

      wallet: {
        id: wallet.id,
        address: wallet.address,
        chainId: wallet.chainId,
      },
    };
  }

  // ============================================================
  // ROLE RESOLUTION
  // ============================================================

  private resolveRole(walletAddress: string): 'admin' | 'user' {
    const adminWallet = this.configService.get<string>('ADMIN_WALLET');

    if (!adminWallet) {
      return 'user';
    }

    try {
      const normalizedAdminWallet = ethers.getAddress(adminWallet);
      const normalizedWalletAddress = ethers.getAddress(walletAddress);

      return normalizedWalletAddress === normalizedAdminWallet
        ? 'admin'
        : 'user';
    } catch {
      return 'user';
    }
  }

  // ============================================================
  // SUPPORTED CHAINS
  // ============================================================

  private getSupportedChains(): number[] {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';

    // Polygon Mainnet
    // BSC Mainnet
    const baseChains = [137, 56];

    // BSC Testnet only during development/test
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return [...baseChains, 97];
    }

    return baseChains;
  }

  // ============================================================
  // AUTH MESSAGE
  // ============================================================

  private buildMessage(walletAddress: string, nonce: string): string {
    return [
      'TradeX Authentication',
      '',
      `Wallet: ${walletAddress}`,
      `Nonce: ${nonce}`,
      '',
      'Sign this message to authenticate with TradeX.',
      'This signature does not authorize any blockchain transaction.',
    ].join('\n');
  }

  private normalizeReferralCode(referralCode?: string): string | undefined {
    const normalized = referralCode?.trim().toUpperCase();
    return normalized ? normalized : undefined;
  }
}
