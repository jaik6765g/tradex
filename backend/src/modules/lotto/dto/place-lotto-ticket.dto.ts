import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const LOTTO_NUMBER_PATTERN = /^[0-9A-F]$/i;

export class PlaceLottoTicketDto {
  @ApiProperty({ example: 101 })
  @IsInt()
  @Min(1)
  roundId: number;

  @ApiProperty({ example: 10.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000)
  amount: number;

  @ApiProperty({
    example: ['0', 'A', 'F'],
    description: 'Selected unique lotto symbols (0-9, A-F)',
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @ArrayUnique({ message: 'selectedNumbers must contain unique symbols' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(LOTTO_NUMBER_PATTERN, {
    each: true,
    message: 'selectedNumbers must contain only symbols 0-9 or A-F',
  })
  selectedNumbers: string[];

  @ApiPropertyOptional({
    example: 'lotto-req-95b8f315-0ea8-4ab9-b318-0fe8f8fb7c03',
    description:
      'Optional idempotency key to prevent duplicate ticket creation (8-128 valid characters)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/, {
    message: 'idempotencyKey must be 8-128 valid characters',
  })
  idempotencyKey?: string;
}
