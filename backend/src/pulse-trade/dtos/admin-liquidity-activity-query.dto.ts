import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminLiquidityActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'ADD', 'REMOVE'])
  action?: 'ALL' | 'ADD' | 'REMOVE';

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'SUCCESS', 'FAILED'])
  result?: 'ALL' | 'SUCCESS' | 'FAILED';

  @IsOptional()
  @IsString()
  adminId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
