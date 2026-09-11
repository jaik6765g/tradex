import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';

import { LedgerType } from '../ledger.entity';

// ============================================================
// CREATE LEDGER ENTRY
// ============================================================
//
// Internal/service-side DTO.
// Amounts are accepted as numbers for compatibility with the
// existing service API. Financial calculations themselves must
// be performed with Decimal.js before reaching the entity.
// ============================================================

export class CreateLedgerEntryDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({
    enum: LedgerType,
  })
  @IsEnum(LedgerType)
  type: LedgerType;

  @ApiProperty({
    example: 100,
  })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    example: 0,
  })
  @IsNumber()
  @Min(0)
  balanceBefore: number;

  @ApiProperty({
    example: 100,
  })
  @IsNumber()
  @Min(0)
  balanceAfter: number;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    type: Object,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

// ============================================================
// LEDGER RESPONSE
// ============================================================
//
// PostgreSQL DECIMAL values are exposed as strings to preserve
// precision.
// ============================================================

export class LedgerResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({
    enum: LedgerType,
  })
  type: LedgerType;

  @ApiProperty({
    example: '100.000000000000000000',
    type: String,
  })
  amount: string;

  @ApiProperty({
    example: '0.000000000000000000',
    type: String,
  })
  balanceBefore: string;

  @ApiProperty({
    example: '100.000000000000000000',
    type: String,
  })
  balanceAfter: string;

  @ApiProperty({
    required: false,
  })
  description?: string;

  @ApiProperty()
  createdAt: Date;
}
