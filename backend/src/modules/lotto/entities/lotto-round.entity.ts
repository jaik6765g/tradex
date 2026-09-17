// backend/src/lotto/entities/lotto-round.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { LottoTicket } from './lotto-ticket.entity';
import { LottoResult } from './lotto-result.entity';
import { LottoSettlement } from './lotto-settlement.entity';
import { AdminAction } from './admin-action.entity';

export enum Category {
  THIRTY_SEC = 'THIRTY_SEC',
  ONE_MIN = 'ONE_MIN',
  THREE_MIN = 'THREE_MIN',
  FIVE_MIN = 'FIVE_MIN',
}

export enum RoundStatus {
  OPEN = 'OPEN',
  CUTOFF = 'CUTOFF',
  DRAWING = 'DRAWING',
  RESULTED = 'RESULTED',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

@Entity('lotto_rounds')
@Index(['category', 'status'])
@Index(['drawAt'])
@Index('IDX_lotto_rounds_category_round_number_unique', ['category', 'roundNumber'], {
  unique: true,
})
export class LottoRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  roundNumber: string;

  @Column({
    type: 'enum',
    enum: Category,
    default: Category.THIRTY_SEC,
  })
  category: Category;

  @Column({
    type: 'enum',
    enum: RoundStatus,
    default: RoundStatus.OPEN,
  })
  status: RoundStatus;

  @CreateDateColumn()
  startAt: Date;

  @Column({ type: 'timestamp' })
  cutoffAt: Date;

  @Column({ type: 'timestamp' })
  drawAt: Date;

  @Column({ type: 'int', nullable: true })
  resultId: number | null;

  @Column({ nullable: true, type: 'timestamp' })
  resultGeneratedAt: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  settledAt: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  failedAt: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  refundedAt: Date | null;

  @Column({ nullable: true, type: 'text' })
  errorMessage: string | null;

  @Column({ default: 0 })
  totalTickets: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalAmount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @OneToMany(() => LottoTicket, (ticket) => ticket.round)
  tickets: LottoTicket[];

  @OneToOne(() => LottoResult)
  @JoinColumn({ name: 'resultId' })
  result: LottoResult;

  @OneToMany(() => LottoSettlement, (settlement) => settlement.round)
  settlements: LottoSettlement[];

  @OneToMany(() => AdminAction, (action) => action.round)
  adminActions: AdminAction[];
}
