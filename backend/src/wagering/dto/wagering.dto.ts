import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ArrayMinSize,
} from 'class-validator';

import { EligibleActivity } from '../entities/wagering-settings.entity';

export const WAGERING_WITHDRAWAL_BLOCKED_CODE = 'WAGERING_REQUIREMENT_INCOMPLETE';
export const WAGERING_SETTINGS_CONFLICT_CODE = 'WAGERING_SETTINGS_CONCURRENT_UPDATE';

export class UpdateWageringSettingsDto {
  @IsOptional()
  @IsBoolean()
  wageringEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  defaultMultiplier?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(100, { each: true })
  allowedMultipliers?: number[];

  @IsOptional()
  @IsIn(Object.values(EligibleActivity))
  eligibleActivity?: EligibleActivity;

  @IsOptional()
  @IsBoolean()
  withdrawalEnforcement?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyUsers?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  expiryDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  reconciliationMaxAgeDays?: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}

export class SetWageringOverrideDto {
  @IsUUID()
  userId: string;

  @IsInt()
  @Min(1)
  @Max(100)
  multiplier: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}

export class RemoveWageringOverrideDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}

export class CancelObligationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  reason: string;
}

export class WageringAdminQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class WageringAuditQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn([
    'WAGERING_SETTINGS_UPDATE',
    'WAGERING_OVERRIDE_SET',
    'WAGERING_OVERRIDE_REMOVE',
    'WAGERING_OBLIGATION_CANCEL',
    'WAGERING_RECONCILE_RUN',
  ])
  action?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}