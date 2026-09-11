import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { DepositStatus } from '../deposit.entity';

export class CreateDepositDto {
  @ApiProperty()
  @IsString()
  transactionHash: string;

  @ApiProperty()
  @IsNumber()
  chainId: number;

  @ApiProperty()
  @IsString()
  senderAddress: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  usdtAmount: number;
}

export class UpdateDepositStatusDto {
  @ApiProperty({ enum: DepositStatus })
  @IsEnum(DepositStatus)
  status: DepositStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DepositResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  chainId: number;

  @ApiProperty()
  transactionHash: string;

  @ApiProperty()
  usdtAmount: number;

  @ApiProperty()
  tdxAmount: number;

  @ApiProperty()
  status: DepositStatus;

  @ApiProperty()
  confirmations: number;

  @ApiProperty()
  requiredConfirmations: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  confirmedAt?: Date;

  @ApiProperty()
  creditedAt?: Date;
}

/**
 * Poll-friendly deposit status response.
 *
 * `found: false` means the backend watcher has not detected/created the
 * deposit record yet — the authoritative state is still "processing".
 * `found: true` returns the actual DB status. COMPLETED is only ever
 * returned after creditDeposit() has succeeded (creditedAt set).
 */
export class DepositStatusResponseDto {
  @ApiProperty()
  found: boolean;

  @ApiProperty({ enum: DepositStatus })
  status: DepositStatus;

  @ApiProperty()
  credited: boolean;
}
