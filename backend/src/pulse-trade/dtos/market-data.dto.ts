import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MarketDataDto {
  @ApiProperty({ example: 'BTC/USDT' })
  @IsNotEmpty()
  @IsString()
  pair: string;

  @ApiProperty({ example: 65000.5 })
  price: number;
}
