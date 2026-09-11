import { Body, Controller, Post } from '@nestjs/common';

import { AuthService } from './auth.service';

import { NonceDto } from './dto/nonce.dto';
import { VerifyDto } from './dto/verify.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ============================================================
  // CREATE NONCE
  // ============================================================

  @Post('nonce')
  createNonce(@Body() dto: NonceDto) {
    return this.authService.createNonce(dto.walletAddress);
  }

  // ============================================================
  // VERIFY WALLET SIGNATURE
  // ============================================================
  //
  // Existing wallet:
  //   registered = true
  //   accessToken returned
  //
  // New wallet:
  //   registered = false
  //   registrationRequired = true
  //   registrationToken returned
  // ============================================================

  @Post('verify')
  verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignature(
      dto.walletAddress,
      dto.signature,
      dto.nonce,
      dto.chainId,
      dto.referralCode,
    );
  }

  // ============================================================
  // REGISTER NEW WALLET
  // ============================================================
  //
  // IMPORTANT:
  // Registration no longer accepts signature + nonce.
  //
  // /auth/verify already verified the wallet signature and
  // returned a short-lived registrationToken.
  //
  // Frontend sends:
  //
  // {
  //   walletAddress,
  //   registrationToken,
  //   chainId,
  //   referralCode
  // }
  // ============================================================

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.registerUser(
      dto.walletAddress,
      dto.registrationToken,
      dto.chainId,
      dto.referralCode,
    );
  }
}
