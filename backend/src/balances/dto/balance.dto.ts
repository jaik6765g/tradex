import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 100.0 })
  availableBalance: number;

  @ApiProperty({ example: 0.0 })
  lockedBalance: number;

  @ApiProperty({ example: 0.0 })
  gameLocked: number;

  @ApiProperty({ example: 0.0 })
  tradingLocked: number;

  @ApiProperty({ example: 0.0 })
  withdrawalLocked: number;

  @ApiProperty({ example: 100.0 })
  totalBalance: number;
}
