import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { ALL_BONUS_CATEGORIES } from '../../wagering/bonus-categories';

/** Maximum TDX that can be distributed as a single manual admin bonus. */
export const ADMIN_BONUS_MAX_AMOUNT = 10000;

/** Minimum TDX for a single manual admin bonus. */
export const ADMIN_BONUS_MIN_AMOUNT = 0.01;

export class DistributeBonusDto {
  @ApiProperty({
    example: '95b8f315-0ea8-4ab9-b318-0fe8f8fb7c03',
    description: 'Target user UUID',
  })
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId: string;

  @ApiProperty({
    example: 100,
    description: `Bonus amount in TDX (${ADMIN_BONUS_MIN_AMOUNT} - ${ADMIN_BONUS_MAX_AMOUNT}, max 2 decimals)`,
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'amount must be a number with at most 2 decimal places' },
  )
  @Min(ADMIN_BONUS_MIN_AMOUNT, {
    message: `amount must be at least ${ADMIN_BONUS_MIN_AMOUNT}`,
  })
  @Max(ADMIN_BONUS_MAX_AMOUNT, {
    message: `amount must not exceed ${ADMIN_BONUS_MAX_AMOUNT}`,
  })
  amount: number;

  @ApiProperty({
    example: 'Referral campaign reward - October 2026',
    description:
      'Reason why the bonus is granted (stored on ledger + audit log)',
  })
  @IsString()
  @IsNotEmpty({ message: 'description is required' })
  @Length(3, 500, {
    message: 'description must be between 3 and 500 characters',
  })
  description: string;

  @ApiPropertyOptional({
    example: 'bonus-req-95b8f315-0ea8-4ab9-b318-0fe8f8fb7c03',
    description:
      'Optional idempotency key to prevent duplicate bonus distribution (8-128 valid characters)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/, {
    message: 'idempotencyKey must be 8-128 valid characters',
  })
  idempotencyKey?: string;

  @ApiPropertyOptional({
    enum: ALL_BONUS_CATEGORIES as unknown as string[],
    default: 'MANUAL_BONUS',
    description:
      'Bonus category. Salary is handled as SALARY_BONUS inside this flow; REFERRAL_BONUS is always non-wagerable.',
  })
  @IsOptional()
  @IsIn(ALL_BONUS_CATEGORIES as unknown as string[], {
    message: `bonusCategory must be one of: ${ALL_BONUS_CATEGORIES.join(', ')}`,
  })
  bonusCategory?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Create a wagering obligation for this bonus. Forced to false (and an explicit true is REJECTED) for REFERRAL_BONUS.',
  })
  @IsOptional()
  @IsBoolean({ message: 'wageringRequired must be a boolean' })
  wageringRequired?: boolean;

  @ApiPropertyOptional({
    example: '2',
    description:
      'Wagering multiplier: 1, 2, 3 or a CUSTOM positive decimal (max 100). Only used when wageringRequired=true; exact Decimal validation.',
  })
  @IsOptional()
  wageringMultiplier?: string | number;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.000Z',
    description: 'Optional expiry for the wagering obligation (ISO 8601, future).',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'expiresAt must be a valid ISO 8601 date-time' })
  expiresAt?: string;
}

export class QueryAdminBonusHistoryDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    example: '95b8f315-0ea8-4ab9-b318-0fe8f8fb7c03',
    description: 'Filter bonus history by user UUID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;
}
