import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

export enum LedgerType {
  DEPOSIT = 'DEPOSIT',

  WITHDRAWAL = 'WITHDRAWAL',

  GAME_ENTRY = 'GAME_ENTRY',

  GAME_WIN = 'GAME_WIN',

  GAME_FEE = 'GAME_FEE',

  TRADE_ENTRY = 'TRADE_ENTRY',

  TRADE_PROFIT = 'TRADE_PROFIT',

  TRADE_LOSS = 'TRADE_LOSS',

  TRADE_DRAW = 'TRADE_DRAW',

  TRADE_FEE = 'TRADE_FEE',

  WITHDRAWAL_LOCK = 'WITHDRAWAL_LOCK',

  WITHDRAWAL_RELEASE = 'WITHDRAWAL_RELEASE',

  ADMIN_ADJUSTMENT = 'ADMIN_ADJUSTMENT',

  BOT_FIRST_ACTIVATION_REFERRAL = 'BOT_FIRST_ACTIVATION_REFERRAL',

  BOT_FIRST_ACTIVATION_LIQUIDITY = 'BOT_FIRST_ACTIVATION_LIQUIDITY',
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'user_id',
  })
  userId: string;

  @Column({
    type: 'enum',
    enum: LedgerType,
  })
  type: LedgerType;

  @Column({
    type: 'decimal',
    precision: 36,
    scale: 18,
  })
  amount: string;

  @Column({
    name: 'balance_before',
    type: 'decimal',
    precision: 36,
    scale: 18,
  })
  balanceBefore: string;

  @Column({
    name: 'balance_after',
    type: 'decimal',
    precision: 36,
    scale: 18,
  })
  balanceAfter: string;

  @Column({
    name: 'reference_id',
    nullable: true,
  })
  referenceId: string;

  @Column({
    name: 'reference_type',
    nullable: true,
  })
  referenceType: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  description: string;

  @Column({
    type: 'jsonb',
    default: {},
  })
  metadata: Record<string, unknown>;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({
    name: 'user_id',
  })
  user: User;
}
