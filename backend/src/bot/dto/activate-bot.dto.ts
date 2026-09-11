import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ActivateBotDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'amount must be a valid decimal amount',
  })
  amount: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/, {
    message: 'idempotencyKey must be 8-128 valid characters',
  })
  idempotencyKey: string;
}
