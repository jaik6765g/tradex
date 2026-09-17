// backend/src/lotto/entities/lotto-ticket.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { User } from '../../../users/user.entity';
import { LottoRound } from './lotto-round.entity';
import { Category } from './lotto-round.entity';
import { LottoSettlement } from './lotto-settlement.entity';
import { ReferralBonus } from './referral-bonus.entity';
import { LedgerEntry } from '../../../ledger/ledger.entity';

const LOTTO_CATEGORY_VALUES = [
  'THIRTY_SEC',
  'ONE_MIN',
  'THREE_MIN',
  'FIVE_MIN',
] as const;

export enum TicketStatus {
  ACTIVE = 'ACTIVE',
  CUTOFF = 'CUTOFF',
  WIN = 'WIN',
  LOSS = 'LOSS',
  SETTLED = 'SETTLED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum ReservationStatus {
  NONE = 'NONE',
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
  CONSUMED = 'CONSUMED',
}

@Entity('lotto_tickets')
@Index(['userId', 'roundId'])
@Index(['status'])
@Index(['ticketNumber'])
@Index(
  'IDX_lotto_tickets_user_idempotency_unique',
  ['userId', 'idempotencyKey'],
  {
    unique: true,
    where: '"idempotencyKey" IS NOT NULL',
  },
)
export class LottoTicket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  ticketNumber: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  roundId: number;

  @Column({
    type: 'enum',
    enum: LOTTO_CATEGORY_VALUES,
    enumName: 'lotto_rounds_category_enum',
  })
  category: Category;

  @Column({ length: 50 })
  roundNumber: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  deductionAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  referralAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  adminAmount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  netAmount: number;

  @Column({ length: 50 })
  selectedNumbers: string; // "0,1,2,3"

  @Column()
  selectionCount: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  multiplier: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  maxPayoutLiability: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  reservedAmount: number;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.NONE,
  })
  reservationStatus: ReservationStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @Column({
    type: 'enum',
    enum: TicketStatus,
    default: TicketStatus.ACTIVE,
  })
  status: TicketStatus;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  winAmount: number | null;

  @Column({ type: 'uuid', nullable: true })
  purchaseTxId: string | null;

  @Column({ type: 'uuid', nullable: true })
  settlementTxId: string | null;

  @Column({ type: 'uuid', nullable: true })
  refundTxId: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  settledAt: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  refundedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => LottoRound, (round) => round.tickets)
  @JoinColumn({ name: 'roundId' })
  round: LottoRound;

  @ManyToOne(() => LedgerEntry)
  @JoinColumn({ name: 'purchaseTxId' })
  purchaseTx: LedgerEntry;

  @ManyToOne(() => LedgerEntry)
  @JoinColumn({ name: 'settlementTxId' })
  settlementTx: LedgerEntry;

  @ManyToOne(() => LedgerEntry)
  @JoinColumn({ name: 'refundTxId' })
  refundTx: LedgerEntry;

  @OneToOne(() => LottoSettlement, (settlement) => settlement.ticket)
  settlement: LottoSettlement;

  @OneToMany(() => ReferralBonus, (bonus) => bonus.ticket)
  referralBonuses: ReferralBonus[];
}
