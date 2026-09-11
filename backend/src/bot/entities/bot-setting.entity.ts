import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('bot_settings')
export class BotSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Minimum amount required to activate a Bot ID.
   * Admin configurable.
   */
  @Column({
    name: 'minimum_activation',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '10000',
  })
  minimumActivation: string;

  /**
   * Maximum allowed activation amount.
   */
  @Column({
    name: 'maximum_activation',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '1000000',
  })
  maximumActivation: string;

  /**
   * Initial activation allocation.
   * Default specification = 90%.
   */
  @Column({
    name: 'liquidity_allocation_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '90',
  })
  liquidityAllocationRate: string;

  /**
   * Initial referral reserve.
   * Default specification = 10%.
   */
  @Column({
    name: 'first_referral_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '10',
  })
  firstReferralRate: string;

  /**
   * Monthly total generation model.
   * Default specification = 6.5%.
   */
  @Column({
    name: 'monthly_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '6.5',
  })
  monthlyRate: string;

  /**
   * Monthly user allocation.
   * Default = 5.5%.
   */
  @Column({
    name: 'monthly_user_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '5.5',
  })
  monthlyUserRate: string;

  /**
   * Monthly referral allocation.
   * Default = 1%.
   */
  @Column({
    name: 'monthly_referral_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '1',
  })
  monthlyReferralRate: string;

  /**
   * One-time referral rates.
   *
   * 6 + 1.5 + 1 + 0.6 + 0.5 + 0.4 = 10%
   */
  @Column({
    name: 'first_referral_level_1_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '6',
  })
  firstReferralLevel1Rate: string;

  @Column({
    name: 'first_referral_level_2_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '1.5',
  })
  firstReferralLevel2Rate: string;

  @Column({
    name: 'first_referral_level_3_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '1',
  })
  firstReferralLevel3Rate: string;

  @Column({
    name: 'first_referral_level_4_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.6',
  })
  firstReferralLevel4Rate: string;

  @Column({
    name: 'first_referral_level_5_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.5',
  })
  firstReferralLevel5Rate: string;

  @Column({
    name: 'first_referral_level_6_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.4',
  })
  firstReferralLevel6Rate: string;

  /**
   * Direct active Bot qualification threshold for each referral level.
   *
   * A referral recipient must have at least this many ACTIVE direct Bot
   * users to qualify for the corresponding level.
   *
   * Defaults:
   *   L1 = 1, L2 = 2, L3 = 3, L4 = 4, L5 = 5, L6 = 6
   */
  @Column({
    name: 'first_referral_level_1_direct_required',
    type: 'int',
    default: 1,
  })
  firstReferralLevel1DirectRequired: number;

  @Column({
    name: 'first_referral_level_2_direct_required',
    type: 'int',
    default: 2,
  })
  firstReferralLevel2DirectRequired: number;

  @Column({
    name: 'first_referral_level_3_direct_required',
    type: 'int',
    default: 3,
  })
  firstReferralLevel3DirectRequired: number;

  @Column({
    name: 'first_referral_level_4_direct_required',
    type: 'int',
    default: 4,
  })
  firstReferralLevel4DirectRequired: number;

  @Column({
    name: 'first_referral_level_5_direct_required',
    type: 'int',
    default: 5,
  })
  firstReferralLevel5DirectRequired: number;

  @Column({
    name: 'first_referral_level_6_direct_required',
    type: 'int',
    default: 6,
  })
  firstReferralLevel6DirectRequired: number;

  /**
   * Monthly referral rates.
   *
   * 0.55 + 0.20 + 0.10 + 0.05 + 0.05 + 0.05 = 1%
   */
  @Column({
    name: 'monthly_referral_level_1_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.55',
  })
  monthlyReferralLevel1Rate: string;

  @Column({
    name: 'monthly_referral_level_2_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.20',
  })
  monthlyReferralLevel2Rate: string;

  @Column({
    name: 'monthly_referral_level_3_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.10',
  })
  monthlyReferralLevel3Rate: string;

  @Column({
    name: 'monthly_referral_level_4_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.05',
  })
  monthlyReferralLevel4Rate: string;

  @Column({
    name: 'monthly_referral_level_5_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.05',
  })
  monthlyReferralLevel5Rate: string;

  @Column({
    name: 'monthly_referral_level_6_rate',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: '0.05',
  })
  monthlyReferralLevel6Rate: string;

  /**
   * Monthly settlement period.
   */
  @Column({
    name: 'settlement_period',
    type: 'varchar',
    length: 32,
    default: 'monthly',
  })
  settlementPeriod: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  enabled: boolean;

  @Column({
    name: 'updated_by',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  updatedBy: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;
}
