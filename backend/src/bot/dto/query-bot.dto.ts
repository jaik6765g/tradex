import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum BotActivityFilter {
  ALL = 'ALL',
  TRADE = 'TRADE',
  WALLET = 'WALLET',
  STATUS = 'STATUS',
}

export class BotActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(BotActivityFilter)
  filter?: BotActivityFilter;
}
