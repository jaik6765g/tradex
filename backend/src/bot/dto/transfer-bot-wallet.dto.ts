import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';

export enum BotWalletTransferDirection {
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
}

export class TransferBotWalletDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'amount must be a valid positive decimal amount',
  })
  amount: string;

  @IsEnum(BotWalletTransferDirection)
  direction: BotWalletTransferDirection;
}
