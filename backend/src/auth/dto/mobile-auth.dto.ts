import {
  IsEmail,
  IsEthereumAddress,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const MOBILE_REGEX = /^\+[1-9]\d{6,14}$/;

export class SignupDto {
  @IsString()
  @Matches(MOBILE_REGEX, { message: 'Invalid mobile number' })
  mobileNumber: string;

  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}

export class LoginDto {
  @IsString()
  @Matches(MOBILE_REGEX, { message: 'Invalid mobile number' })
  mobileNumber: string;

  @IsString()
  password: string;
}

export class ForgotPasswordDto {
  @IsString()
  @Matches(MOBILE_REGEX, { message: 'Invalid mobile number' })
  mobileNumber: string;
}

export class ResetPasswordDto {
  @IsString()
  @Matches(MOBILE_REGEX, { message: 'Invalid mobile number' })
  mobileNumber: string;

  @IsString()
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}

export class LinkWalletDto {
  @IsEthereumAddress()
  walletAddress: string;

  @IsString()
  signature: string;

  @IsString()
  message: string;

  @IsInt()
  chainId: number;
}

export class ClaimWalletDto extends LinkWalletDto {
  @IsString()
  accessToken: string;
}
