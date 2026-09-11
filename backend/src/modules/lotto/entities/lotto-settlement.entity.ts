// backend/src/lotto/entities/lotto-settlement.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LottoTicket } from './lotto-ticket.entity';
import { User } from '../../../users/user.entity';
import { LottoRound } from './lotto-round.entity';

export enum SettlementOutcome {
  PENDING = 'PENDING',
  WIN = 'WIN',
  LOSS = 'LOSS',
}

export enum SettlementStatus {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

@Entity('lotto_settlements')
@Index(['ticketId'])
@Index(['userId'])
@Index(['roundId'])
@Index(['status'])
export class LottoSettlement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  ticketId: number;

  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  roundId: number;

  @Column({ length: 1 })
  result: string;

  @Column({
    type: 'enum',
    enum: SettlementOutcome,
    default: SettlementOutcome.PENDING,
  })
  outcome: SettlementOutcome;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  calculatedPayout: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  payoutAmount: number;

  @Column({
    type: 'enum',
    enum: SettlementStatus,
    default: SettlementStatus.PENDING,
  })
  status: SettlementStatus;

  @Column({ nullable: true, type: 'timestamp' })
  settledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @OneToOne(() => LottoTicket)
  @JoinColumn({ name: 'ticketId' })
  ticket: LottoTicket;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => LottoRound, (round) => round.settlements)
  @JoinColumn({ name: 'roundId' })
  round: LottoRound;
}
