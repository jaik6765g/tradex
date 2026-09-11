import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum BotActivationStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('bot_activations')
@Index('IDX_bot_activations_bot_account_created', ['botAccountId', 'createdAt'])
@Index('UQ_bot_activations_idempotency_key', ['idempotencyKey'], {
  unique: true,
})
export class BotActivation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'bot_account_id',
    type: 'uuid',
  })
  botAccountId: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  principal: string;

  @Column({
    name: 'liquidity_amount',
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  liquidityAmount: string;

  @Column({
    name: 'first_referral_reserve',
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  firstReferralReserve: string;

  @Column({
    type: 'enum',
    enum: BotActivationStatus,
    default: BotActivationStatus.PENDING,
  })
  status: BotActivationStatus;

  /**
   * First qualifying activation only.
   */
  @Column({
    name: 'is_first_qualifying_activation',
    type: 'boolean',
    default: false,
  })
  isFirstQualifyingActivation: boolean;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    unique: true,
  })
  idempotencyKey: string;

  @Column({
    name: 'blockchain_tx_hash',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  blockchainTxHash: string | null;

  @Column({
    name: 'activated_at',
    type: 'timestamptz',
    nullable: true,
  })
  activatedAt: Date | null;

  @Column({
    name: 'failure_reason',
    type: 'text',
    nullable: true,
  })
  failureReason: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;
}
