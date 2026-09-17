import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { WIN_STRATEGY_VALUES } from '../utils/lotto-win-strategy.util';

export const SUPPORTED_WIN_STRATEGIES = [...WIN_STRATEGY_VALUES];

export class AdminLottoWinStrategyDto {
  @ApiProperty({
    enum: SUPPORTED_WIN_STRATEGIES,
    description:
      'RANDOM (no steering, uniform draw) | HIGH (highest win-potential symbol wins) | MEDIUM (win potential closest to the min/max mid-point) | LOW (lowest win-potential symbol wins)',
  })
  @IsString()
  @IsIn(SUPPORTED_WIN_STRATEGIES)
  winStrategy: string;

  @ApiPropertyOptional({
    description: 'Optional admin note recorded in the audit log',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
