import { IsInt, IsString, Matches } from 'class-validator';

export class CreateDepositOrderDto {
  @IsInt()
  chainId: number;

  @IsString()
  @Matches(/^[A-Za-z]{2,10}$/, { message: 'Invalid asset symbol' })
  asset: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, { message: 'Invalid amount' })
  amount: string;
}
