import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BotWallet } from './bot-wallet.entity';

export enum BotWalletTransactionType {
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
  BOT_ACTIVATION = 'BOT_ACTIVATION',
  BOT_DEACTIVATION = 'BOT_DEACTIVATION',
  PROFIT_CREDIT = 'PROFIT_CREDIT',
  LOSS_DEBIT = 'LOSS_DEBIT',
  SETTLEMENT = 'SETTLEMENT',
}

export enum BotWalletTransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('bot_wallet_transactions')
export class BotWalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bot_wallet_id' })
  botWalletId: string;

  @ManyToOne(() => BotWallet)
  @JoinColumn({ name: 'bot_wallet_id' })
  botWallet: BotWallet;

  @Column({
    type: 'enum',
    enum: BotWalletTransactionType,
  })
  type: BotWalletTransactionType;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({
    type: 'enum',
    enum: BotWalletTransactionStatus,
    default: BotWalletTransactionStatus.PENDING,
  })
  status: BotWalletTransactionStatus;

  @Column({ name: 'balance_before', type: 'decimal', precision: 36, scale: 18 })
  balanceBefore: string;

  @Column({ name: 'balance_after', type: 'decimal', precision: 36, scale: 18 })
  balanceAfter: string;

  @Column({ name: 'reference_type', nullable: true })
  referenceType: string;

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  idempotencyKey: string | null;

  @Column({
    type: 'jsonb',
    default: '{}',
  })
  metadata: Record<string, unknown>;

  @Column({ nullable: true })
  description: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
