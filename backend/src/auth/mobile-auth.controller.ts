import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MobileAuthService } from './mobile-auth.service';
import type { AuthenticatedRequest } from './interfaces/authenticated-request.interface';

import {
  ClaimWalletDto,
  ForgotPasswordDto,
  LinkWalletDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/mobile-auth.dto';

@Controller('auth')
export class MobileAuthController {
  constructor(private readonly authService: MobileAuthService) {}

  // Mobile + email + password + referral. No OTP.
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // Mobile + password. Email is resolved internally.
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Generic response — never reveals whether the account exists.
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip?: string) {
    return this.authService.forgotPassword(dto, ip ?? 'unknown');
  }

  // Email OTP verified server-side, then password replaced.
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.me(req.user.authUserId ?? req.user.id);
  }

  // Legacy wallet-only account claim (ownership proof + identity attach).
  // NOT a normal login.
  @Post('wallet/claim')
  claimWallet(@Body() dto: ClaimWalletDto) {
    return this.authService.claimWallet(dto);
  }

  // Connect a crypto wallet for blockchain functionality (post-login).
  @Post('wallet/link')
  @UseGuards(JwtAuthGuard)
  linkWallet(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LinkWalletDto,
  ) {
    return this.authService.linkWallet(req.user.id, dto);
  }
}
