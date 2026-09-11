import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { TradeDirection, TradeResult, TradeStatus } from '../constants/enums';

export class TradeResponseDto {
  @IsString()
  id: string;

  @IsString()
  userId: string;

  @IsString()
  pair: string;

  @IsEnum(TradeDirection)
  direction: TradeDirection;

  @IsNumber()
  duration: number;

  @IsNumber()
  amount: number;

  @IsString()
  entryPrice: string;

  @IsOptional()
  @IsString()
  exitPrice?: string;

  @IsOptional()
  @IsEnum(TradeResult)
  result?: TradeResult;

  @IsEnum(TradeStatus)
  status: TradeStatus;

  @IsString()
  createdAt: string;

  @IsString()
  expiryAt: string;

  @IsOptional()
  @IsString()
  settledAt?: string;

  @IsString()
  updatedAt: string;
}
