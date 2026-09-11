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
