import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const VALUE_TYPES = ['string', 'number', 'boolean', 'json'] as const;

export type AdminSettingValueType = (typeof VALUE_TYPES)[number];

export class UpdateAdminSettingDto {
  @IsString()
  @IsNotEmpty()
  value: string;

  /**
   * Mandatory reason for every setting change (Architecture Plan v3).
   * Persisted in the immutable admin_audit_logs row.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @IsIn(VALUE_TYPES)
  valueType?: AdminSettingValueType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  editable?: boolean;
}
