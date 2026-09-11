import {
  IsEthereumAddress,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class VerifyDto {
  // ============================================================
  // WALLET ADDRESS
  // ============================================================

  @IsEthereumAddress()
  walletAddress: string;

  // ============================================================
  // SIGNATURE
  // ============================================================

  @IsString()
  signature: string;

  // ============================================================
  // AUTH NONCE
  // ============================================================

  @IsString()
  nonce: string;

  // ============================================================
  // BLOCKCHAIN CHAIN ID
  // ============================================================

  @IsInt()
  @Min(1)
  @Max(100000)
  chainId: number;

  // ============================================================
  // OPTIONAL REFERRAL CODE
  //
  // If provided for unregistered wallet flows, this value is
  // normalized and persisted in registration context.
  // ============================================================

  @IsOptional()
  @IsString()
  referralCode?: string;
}
