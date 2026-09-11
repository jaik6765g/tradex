// backend/src/lotto/entities/admin-pool.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { AdminPoolTransaction } from './admin-pool-transaction.entity';

@Entity('admin_pool')
export class AdminPool {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalBalance: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  lockedBalance: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  availableBalance: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalDeposited: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalWithdrawn: number;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => AdminPoolTransaction, (tx) => tx.adminPool)
  transactions: AdminPoolTransaction[];
}
