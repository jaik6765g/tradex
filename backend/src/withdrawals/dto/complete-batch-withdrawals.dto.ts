// backend/src/modules/withdrawals/dto/complete-batch-withdrawals.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

import { WITHDRAWAL_VAULT_MAX_BATCH_SIZE } from '../../blockchain/blockchain.service';

export class CompleteBatchWithdrawalsDto {
  @ApiProperty({
    description:
      'Transaction hash of the single on-chain WithdrawalVault batch payout',
    example: '0x4353d6f80512287ba6fdd28a2491b025c2595961ebd76e5a76a759849820eba3',
  })
  @IsNotEmpty({ message: 'txHash is required' })
  @IsString({ message: 'txHash must be a string' })
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'txHash must be a valid 0x-prefixed 32-byte hash',
  })
  txHash: string;

  @ApiProperty({
    description:
      'IDs of the withdrawals paid out by this single batch transaction',
    example: [
      'withdrawal-id-A',
      'withdrawal-id-B',
      'withdrawal-id-C',
    ],
  })
  @IsArray({ message: 'withdrawalIds must be an array' })
  @ArrayMinSize(1, { message: 'withdrawalIds must not be empty' })
  @ArrayMaxSize(WITHDRAWAL_VAULT_MAX_BATCH_SIZE, {
    message: `withdrawalIds must not exceed the maximum batch size of ${WITHDRAWAL_VAULT_MAX_BATCH_SIZE}`,
  })
  @IsString({ each: true, message: 'every withdrawalId must be a string' })
  withdrawalIds: string[];
}