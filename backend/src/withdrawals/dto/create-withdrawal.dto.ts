import {
  IsEthereumAddress,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreateWithdrawalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;

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
