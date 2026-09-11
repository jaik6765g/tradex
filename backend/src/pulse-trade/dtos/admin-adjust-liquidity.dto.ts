import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class AdminAdjustLiquidityDto {
  @IsString()
  @IsIn(['ADD', 'REMOVE'])
  action: 'ADD' | 'REMOVE';

  @IsString()
  @Matches(/^\d+(\.\d+)?$/, {
    message: 'amount must be a valid positive decimal string',
  })
  amount: string;

  @IsString()
  @MaxLength(120)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
