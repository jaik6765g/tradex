import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdminTradeQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['LONG', 'SHORT', 'ALL'])
  direction?: 'LONG' | 'SHORT' | 'ALL';

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsIn(['WIN', 'LOSS', 'DRAW', 'ALL'])
  result?: 'WIN' | 'LOSS' | 'DRAW' | 'ALL';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
