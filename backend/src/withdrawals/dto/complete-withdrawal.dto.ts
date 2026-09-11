// backend/src/modules/withdrawals/dto/complete-withdrawal.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompleteWithdrawalDto {
  @ApiProperty({
    description:
      'Transaction hash of the on-chain WithdrawalVault payout',
    example: '0x4353d6f80512287ba6fdd28a2491b025c2595961ebd76e5a76a759849820eba3',
  })
  @IsNotEmpty({ message: 'txHash is required' })
  @IsString({ message: 'txHash must be a string' })
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'txHash must be a valid 0x-prefixed 32-byte hash',
  })
  txHash: string;
}