import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as crypto from 'crypto';

import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';

/** Authentication methods recorded in the verified token's `amr` claim. */
interface SupabaseAmrEntry {
  method?: string;
  timestamp?: number;
}

interface SupabaseJwtPayload {
  sub: string;
  phone?: string;
  email?: string;
  exp?: number;
  /** Supabase authenticator assurance level claim (aal1 = password only). */
  aal?: string;
  /** Authentication method references (password / totp / …). */
  amr?: SupabaseAmrEntry[];
}

/**
 * Normalises the verified `aal` claim. Anything that is not exactly `aal2`
 * (missing claim, legacy token, malformed value) is treated as `aal1` so the
 * failure mode is always "MFA still required" — never the opposite.
 */
export function normalizeAal(value: unknown): 'aal1' | 'aal2' {
  return value === 'aal2' ? 'aal2' : 'aal1';
}

interface SupabaseJwk {
  kty: string;
  kid?: string;
  alg?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  use?: string;
}

/**
 * Verifies Supabase-issued access tokens and maps the authenticated Supabase
 * identity to the TradeX user record via users.authUserId.
 *
 * Supabase now signs access tokens with asymmetric keys (ES256 / P-256) whose
 * public keys are published at the project JWKS endpoint. We resolve the
 * signing key by `kid` and verify ES256 tokens against the public key, with an
 * HS256 fallback to the legacy project JWT secret for any older tokens.
 */
@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy) {
  private jwksCache: { keys: SupabaseJwk[]; fetchedAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['ES256', 'HS256'],
      secretOrKeyProvider: (
        _request: any,
        rawJwtToken: any,
        done: (err: any, secretOrKey?: string | Buffer) => void,
      ): void => {
        this.resolveKey(rawJwtToken as string)
          .then((key) => done(null, key))
          .catch((err) => done(err));
      },
    });
  }

  // Resolve the correct verification key for the token's algorithm.
  private async resolveKey(rawJwtToken: string): Promise<string | Buffer> {
    let header: { alg?: string; kid?: string };

    try {
      header = JSON.parse(
        Buffer.from(rawJwtToken.split('.')[0], 'base64url').toString('utf8'),
      );
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    if (header.alg && header.alg.toUpperCase().startsWith('HS')) {
      const secret = this.configService.get<string>('SUPABASE_JWT_SECRET');

      if (!secret) {
        throw new UnauthorizedException('SUPABASE_JWT_SECRET is not configured');
      }

      return secret;
    }

    const jwks = await this.loadJwks();
    const jwk = jwks.keys.find((key) => key.kid === header.kid);

    if (!jwk) {
      throw new UnauthorizedException('Unknown token signing key');
    }

    return this.jwkToPem(jwk);
  }

  private async loadJwks(): Promise<{ keys: SupabaseJwk[] }> {
    const now = Date.now();

    if (this.jwksCache && now - this.jwksCache.fetchedAt < 60 * 60 * 1000) {
      return this.jwksCache;
    }

    const baseUrl = (
      this.configService.get<string>('SUPABASE_URL') ?? ''
    ).replace(/\/+$/, '');

    if (!baseUrl) {
      throw new UnauthorizedException('SUPABASE_URL is not configured');
    }

    const response = await fetch(`${baseUrl}/auth/v1/.well-known/jwks.json`);

    if (!response.ok) {
      throw new UnauthorizedException('Unable to load Supabase signing keys');
    }

    const body = (await response.json()) as { keys?: SupabaseJwk[] };
    this.jwksCache = { keys: body.keys ?? [], fetchedAt: now };

    return this.jwksCache;
  }

  private jwkToPem(jwk: SupabaseJwk): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const publicKey = crypto.createPublicKey({
        key: jwk as any,
        format: 'jwk',
      });

      return publicKey.export({ type: 'spki', format: 'pem' }).toString();
    } catch {
      throw new UnauthorizedException('Unable to parse signing key');
    }
  }

  async validate(payload: SupabaseJwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const user = await this.usersService.findByAuthUserId(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Account is not linked');
    }

    // `aal`/`amr` come from the Supabase-signed payload, which passport-jwt has
    // already verified (ES256 JWKS / HS256 fallback, ignoreExpiration=false).
    // The frontend cannot forge these values — they are covered by the signature.
    const amr = Array.isArray(payload.amr)
      ? payload.amr
          .filter((entry) => entry && typeof entry.method === 'string')
          .map((entry) => ({
            method: String(entry.method),
            timestamp: Number(entry.timestamp ?? 0),
          }))
      : [];

    return {
      id: user.id,
      authUserId: payload.sub,
      mobileNumber: user.mobileNumber,
      email: user.email,
      role: this.resolveRole(user),
      status: user.status,
      aal: normalizeAal(payload.aal),
      amr,
    };
  }

  private resolveRole(user: User): 'admin' | 'user' {
    if (user.role === 'admin') {
      return 'admin';
    }

    // Legacy fallback: the admin wallet from before mobile auth.
    const adminWallet = this.configService.get<string>('ADMIN_WALLET');

    if (adminWallet && user.walletAddress) {
      try {
        if (user.walletAddress.toLowerCase() === adminWallet.toLowerCase()) {
          return 'admin';
        }
      } catch {
        // ignore malformed addresses
      }
    }

    return 'user';
  }
}
