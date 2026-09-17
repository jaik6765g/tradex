import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminSettlementRecoveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}