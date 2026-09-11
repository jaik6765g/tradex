import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { Category } from '../entities/lotto-round.entity';
import { SettlementOutcome } from '../entities/lotto-settlement.entity';
import { TicketStatus } from '../entities/lotto-ticket.entity';

export class AdminLottoTicketsQueryDto {
  @ApiPropertyOptional({ enum: Category })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roundId?: number;

  @ApiPropertyOptional({ description: 'Ticket id (server-side filter)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ticketId?: number;

  @ApiPropertyOptional({ description: 'Round number / period' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roundNumber?: string;

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: SettlementOutcome })
  @IsOptional()
  @IsEnum(SettlementOutcome)
  outcome?: SettlementOutcome;

  @ApiPropertyOptional({ description: 'User id (uuid) — admin permission' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ description: 'Created-at from (ISO date)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Created-at to (ISO date)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}