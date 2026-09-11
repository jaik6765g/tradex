// backend/src/lotto/entities/referral-bonus.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../../users/user.entity';
import { LottoTicket } from './lotto-ticket.entity';
import { LedgerEntry } from '../../../ledger/ledger.entity';

export enum ReferralStatus {
  PENDING = 'PENDING',
  DISTRIBUTED = 'DISTRIBUTED',
  REVERSED = 'REVERSED',
}

@Entity('referral_bonuses')
@Index(['userId'])
@Index(['referrerId'])
@Index(['ticketId'])
@Index(['status'])
export class ReferralBonus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  userId: string; // Who receives bonus

  @Column({ type: 'uuid' })
  referrerId: string; // Who referred

  @Column()
  ticketId: number;

  @Column({ length: 5 })
  level: string; // L1-L6

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  percentage: number;

  @Column({
    type: 'enum',
    enum: ReferralStatus,
    default: ReferralStatus.PENDING,
  })
  status: ReferralStatus;

  @Column({ type: 'uuid', nullable: true })
  transactionId: string;

  @Column({ nullable: true, type: 'timestamp' })
  distributedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referrerId' })
  referrer: User;

  @ManyToOne(() => LottoTicket, (ticket) => ticket.referralBonuses)
  @JoinColumn({ name: 'ticketId' })
  ticket: LottoTicket;

  @ManyToOne(() => LedgerEntry)
  @JoinColumn({ name: 'transactionId' })
  transaction: LedgerEntry;
}
