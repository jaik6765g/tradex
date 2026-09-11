import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BotSettlementStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SETTLED = 'settled',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

@Entity('bot_monthly_settlements')
@Index(
  'UQ_bot_monthly_settlements_account_period',
  ['botAccountId', 'periodStart', 'periodEnd'],
  { unique: true },
)
export class BotMonthlySettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'bot_account_id',
    type: 'uuid',
  })
  botAccountId: string;

  @Column({
    name: 'period_start',
    type: 'date',
  })
  periodStart: string;

  @Column({
    name: 'period_end',
    type: 'date',
  })
  periodEnd: string;

  /**
   * Reference principal used for calculation.
   */
  @Column({
    name: 'principal',
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  principal: string;

  /**
   * Verified/approved monthly generation amount.
   * This is NOT automatically a guaranteed trading return.
   */
  @Column({
    name: 'gross_generation',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  grossGeneration: string;

  @Column({
    name: 'user_allocation',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  userAllocation: string;

  @Column({
    name: 'referral_allocation',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  referralAllocation: string;

  @Column({
    name: 'referral_paid',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  referralPaid: string;

  @Column({
    name: 'referral_returned_to_liquidity',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  referralReturnedToLiquidity: string;

  @Column({
    type: 'enum',
    enum: BotSettlementStatus,
    default: BotSettlementStatus.PENDING,
  })
  status: BotSettlementStatus;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    unique: true,
  })
  idempotencyKey: string;

  @Column({
    name: 'settled_at',
    type: 'timestamptz',
    nullable: true,
  })
  settledAt: Date | null;

  @Column({
    name: 'failure_reason',
    type: 'text',
    nullable: true,
  })
  failureReason: string | null;

  @Column({
    name: 'metadata',
    type: 'jsonb',
    nullable: true,
  })
  metadata: Record<string, unknown> | null;

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
