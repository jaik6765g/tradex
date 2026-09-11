import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, Max, Min } from 'class-validator';
import { TradeDirection } from '../constants/enums';
import {
  PULSE_MAX_TRADE_AMOUNT_TDX,
  PULSE_MIN_TRADE_AMOUNT_TDX,
  PULSE_SUPPORTED_DURATIONS_SECONDS,
  PULSE_SUPPORTED_PAIRS,
} from '../constants/trade-config';

const pulseMinTradeAmount = Number(PULSE_MIN_TRADE_AMOUNT_TDX);
const pulseMaxTradeAmount = Number(PULSE_MAX_TRADE_AMOUNT_TDX);

export class CreateTradeDto {
  @ApiProperty({ example: 'BTC/USDT', enum: PULSE_SUPPORTED_PAIRS })
  @IsIn(PULSE_SUPPORTED_PAIRS)
  pair: string;

  @ApiProperty({ enum: TradeDirection, example: TradeDirection.LONG })
  @IsEnum(TradeDirection)
  direction: TradeDirection;

  @ApiProperty({
    example: 100,
    minimum: pulseMinTradeAmount,
    maximum: pulseMaxTradeAmount,
    description: 'Trade amount in TDX',
  })
  @IsNumber()
  @Min(pulseMinTradeAmount)
  @Max(pulseMaxTradeAmount)
  amount: number;

  @ApiProperty({
    example: 60,
    enum: PULSE_SUPPORTED_DURATIONS_SECONDS,
    description: 'Duration in seconds (30s, 1m, 3m, 5m, 10m)',
  })
  @IsIn(PULSE_SUPPORTED_DURATIONS_SECONDS)
  duration: number;
}
