import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WageringActivityType {
  LOTTO = 'LOTTO',
  TRADE = 'TRADE',
}

export enum WageringEventStatus {
  COUNTED = 'COUNTED',
  REJECTED = 'REJECTED',
}

@Entity('wagering_events')
@Index('IDX_wagering_events_source', ['sourceType', 'sourceId'])
@Index('IDX_wagering_events_obligation', ['obligationId'])
@Index('IDX_wagering_events_user', ['userId', 'createdAt'])
export class WageringEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'userId', type: 'uuid' })
  userId: string;

  @Column({ name: 'activityType', type: 'varchar', length: 10 })
  activityType: WageringActivityType;

  /** 'LOTTO_TICKET' | 'PULSE_TRADE' — matches ledger referenceType semantics. */
  @Column({ name: 'sourceType', type: 'varchar', length: 30 })
  sourceType: string;

  /** ticket.id / trade.id — matches the ledger referenceId for the activity. */
  @Column({ name: 'sourceId', type: 'varchar', length: 64 })
  sourceId: string;

  /** Allocation leg index within one wagering source (0 = single-leg). */
  @Column({ name: 'legIndex', type: 'integer', default: 0 })
  legIndex: number;

  /** Evidence ledger type: GAME_ENTRY | TRADE_ENTRY. */
  @Column({ name: 'ledgerType', type: 'varchar', length: 30 })
  ledgerType: string;

  /** Null only for REJECTED surplus rows. */
  @Column({ name: 'obligationId', type: 'uuid', nullable: true })
  obligationId: string | null;

  @Column({ name: 'wageredAmount', type: 'numeric', precision: 36, scale: 18 })
  wageredAmount: string;

  @Column({
    name: 'allocatedAmount',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  allocatedAmount: string;

  @Column({ type: 'varchar', length: 10, default: WageringEventStatus.COUNTED })
  status: WageringEventStatus;

  @Column({ name: 'rejectReason', type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ name: 'policyVersion', type: 'integer' })
  policyVersion: number;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;
}