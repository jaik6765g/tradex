// backend/src/lotto/entities/admin-pool-transaction.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { AdminPool } from './admin-pool.entity';
import { User } from '../../../users/user.entity';

export enum AdminPoolTxType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  BONUS = 'BONUS',
  LEADERBOARD = 'LEADERBOARD',
  PROMOTION = 'PROMOTION',
}

@Entity('admin_pool_transactions')
export class AdminPoolTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  adminPoolId: number;

  @Column({
    type: 'enum',
    enum: AdminPoolTxType,
    default: AdminPoolTxType.DEPOSIT,
  })
  type: AdminPoolTxType;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  balanceBefore: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  balanceAfter: number;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ length: 100, nullable: true })
  referenceId: string;

  @Column({ type: 'uuid', nullable: true })
  adminId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => AdminPool, (pool) => pool.transactions)
  @JoinColumn({ name: 'adminPoolId' })
  adminPool: AdminPool;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'adminId' })
  admin: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;
}
