import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const SUPPORTED_RESULT_MODES = [
  'SERVER_RANDOM',
  'ADMIN_RESULT',
  'VERIFIED_RANDOM',
];

export class AdminLottoResultModeDto {
  @ApiProperty({ enum: SUPPORTED_RESULT_MODES })
  @IsString()
  @IsIn(SUPPORTED_RESULT_MODES)
  resultMode: string;

  @ApiPropertyOptional({
    description: 'Optional admin note recorded in the audit log',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}