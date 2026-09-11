import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SUPPORTED_RESULT_SYMBOLS } from './admin-lotto.constants';

export class AdminLottoManualResultDto {
  @ApiProperty({
    example: 'F',
    description: 'Manual result symbol (0-9, A-F) finalizing the round draw',
  })
  @IsString()
  @Matches(/^[0-9A-F]$/i, {
    message: 'result must be a single symbol 0-9 or A-F',
  })
  @IsIn(SUPPORTED_RESULT_SYMBOLS)
  result: string;

  @ApiPropertyOptional({
    description: 'Optional admin note recorded in the audit log',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}