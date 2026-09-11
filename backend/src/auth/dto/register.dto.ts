import {
  IsEthereumAddress,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterDto {
  // ============================================================
  // WALLET ADDRESS
  // ============================================================

  @IsEthereumAddress()
  walletAddress: string;

  // ============================================================
  // REGISTRATION TOKEN
  // ============================================================
  //
  // /auth/verify successful signature verification ke baad
  // new/unregistered wallet ko ye short-lived token milta hai.
  //
  // Registration ke time isi token se prove hota hai ki wallet
  // pehle authentication signature successfully complete kar
  // chuka hai.
  // ============================================================

  @IsString()
  registrationToken: string;

  // ============================================================
  // CHAIN ID
  // ============================================================

  @IsInt()
  @Min(1)
  @Max(100000)
  chainId: number;

  // ============================================================
  // REFERRAL CODE
  // ============================================================
  //
  // Optional:
  // - Referral ke bina bhi registration possible
  // - Agar diya gaya hai to AuthService validate karega
  // ============================================================

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
