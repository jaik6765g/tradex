import {
  IsEthereumAddress,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWithdrawalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;

  /**
   * Optional user-scoped idempotency key. Replaying the same value returns
   * the original withdrawal; reusing it with a different payload is rejected
   * with 409 WITHDRAWAL_IDEMPOTENCY_PAYLOAD_MISMATCH.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  clientRequestId?: string;

  @IsEthereumAddress()
  walletAddress: string;

  @IsInt()
  @Min(1)
  chainId: number;

  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @Matches(/^\d+(\.\d{1,18})?$/)
  tdxAmount: string;
}
