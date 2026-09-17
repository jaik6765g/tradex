import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, ArrayMaxSize, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class BscGasBatchPreviewDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Type(() => String)
  recipients: string[];

  @IsOptional()
  @IsBoolean()
  allowZeroUsdt?: boolean;
}

export class BscGasBatchSendDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  recipients: string[];

  /** Idempotency key returned by batch-preview; required. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;

  /** Explicit admin confirmation flag — must be true. */
  @IsBoolean()
  confirmed: boolean;

  @IsOptional()
  @IsBoolean()
  allowZeroUsdt?: boolean;
}

export class BscBulkSweepDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  depositAddressIds: string[];
}
