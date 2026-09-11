import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  walletAddress: string;
  walletId: string;
  chainId: number;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly normalizedAdminWallet?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const adminWallet = configService.get<string>('ADMIN_WALLET');
    let normalizedAdminWallet: string | undefined;
    let hasInvalidAdminWallet = false;

    if (adminWallet) {
      try {
        normalizedAdminWallet = ethers.getAddress(adminWallet);
      } catch {
        normalizedAdminWallet = undefined;
      }

      if (!normalizedAdminWallet) {
        hasInvalidAdminWallet = true;
      }
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });

    this.normalizedAdminWallet = normalizedAdminWallet;

    if (!adminWallet) {
      this.logger.warn(
        'ADMIN_WALLET is not configured. Admin access will be denied.',
      );
    } else if (hasInvalidAdminWallet) {
      this.logger.warn('ADMIN_WALLET is invalid. Admin access will be denied.');
    }
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findByAddress(payload.walletAddress);

    if (!user || user.id !== payload.sub) {
      throw new UnauthorizedException('Invalid token subject');
    }

    return {
      id: payload.sub,
      walletAddress: payload.walletAddress,
      role: this.resolveRole(user.walletAddress),
      status: user.status,
    };
  }

  private resolveRole(walletAddress: string): 'admin' | 'user' {
    const normalizedWalletAddress = this.normalizeAddress(walletAddress);

    if (!normalizedWalletAddress || !this.normalizedAdminWallet) {
      return 'user';
    }

    return normalizedWalletAddress === this.normalizedAdminWallet
      ? 'admin'
      : 'user';
  }

  private normalizeAddress(address: string): string | undefined {
    try {
      return ethers.getAddress(address);
    } catch {
      return undefined;
    }
  }
}
