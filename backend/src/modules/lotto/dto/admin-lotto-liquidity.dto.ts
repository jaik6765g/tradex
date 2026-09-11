import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminLottoLiquidityDto {
  @ApiProperty({ example: 5000, description: 'Amount in TDX (max 2 decimals)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000000)
  amount: number;

  @ApiPropertyOptional({ description: 'Optional admin reason (audited)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}