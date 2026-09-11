import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

@Entity('balances')
export class Balance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'user_id',
  })
  userId: string;

  @Column({
    name: 'available_balance',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  availableBalance: string;

  @Column({
    name: 'locked_balance',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  lockedBalance: string;

  @Column({
    name: 'game_locked',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  gameLocked: string;

  @Column({
    name: 'trading_locked',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  tradingLocked: string;

  @Column({
    name: 'withdrawal_locked',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  withdrawalLocked: string;

  @Column({
    name: 'total_balance',
    type: 'decimal',
    precision: 36,
    scale: 18,
    default: '0',
  })
  totalBalance: string;

  @Column({
    name: 'last_updated_at',
    type: 'timestamp',
    default: () => 'NOW()',
  })
  lastUpdatedAt: Date;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
  })
  updatedAt: Date;

  @OneToOne(() => User)
  @JoinColumn({
    name: 'user_id',
  })
  user: User;
}
