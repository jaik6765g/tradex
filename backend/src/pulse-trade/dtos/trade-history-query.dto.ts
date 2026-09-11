import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TradeDirection, TradeStatus } from '../constants/enums';

export class TradeHistoryQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ example: 'BTC/USDT' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({ enum: TradeStatus })
  @IsOptional()
  @IsEnum(TradeStatus)
  status?: TradeStatus;

  @ApiPropertyOptional({ enum: TradeDirection })
  @IsOptional()
  @IsEnum(TradeDirection)
  direction?: TradeDirection;

  @ApiPropertyOptional({
    description: 'Duration code like 30S, 1M, 3M, 5M, 10M',
    example: '30S',
  })
  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({
    description: 'ISO from timestamp',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO to timestamp',
    example: '2026-08-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsString()
  to?: string;
}
