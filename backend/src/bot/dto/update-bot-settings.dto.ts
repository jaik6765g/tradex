import { IsInt, IsNotEmpty, IsString, IsOptional, Matches, Min } from 'class-validator';

/**
 * Admin update payload for Bot activation / referral settings.
 *
 * Financial/percentage values are kept as exact decimal strings
 * (max 18 dp) and validated with Decimal.js inside BotService.
 * Direct-qualification thresholds are integers.
 */
export class UpdateBotSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'minimumActivation must be a valid decimal string',
  })
  minimumActivation?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'maximumActivation must be a valid decimal string',
  })
  maximumActivation?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'liquidityAllocationRate must be a valid decimal string',
  })
  liquidityAllocationRate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralRate must be a valid decimal string',
  })
  firstReferralRate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel1Rate must be a valid decimal string',
  })
  firstReferralLevel1Rate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel2Rate must be a valid decimal string',
  })
  firstReferralLevel2Rate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel3Rate must be a valid decimal string',
  })
  firstReferralLevel3Rate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel4Rate must be a valid decimal string',
  })
  firstReferralLevel4Rate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel5Rate must be a valid decimal string',
  })
  firstReferralLevel5Rate?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'firstReferralLevel6Rate must be a valid decimal string',
  })
  firstReferralLevel6Rate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel1DirectRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel2DirectRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel3DirectRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel4DirectRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel5DirectRequired?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstReferralLevel6DirectRequired?: number;
}