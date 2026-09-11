import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { TradeSnapshot } from './trade-snapshot.entity';
import { TradeDirection, TradeResult, TradeStatus } from '../constants/enums';
import { User } from '../../users/user.entity';

@Entity('pulse_trades')
@Index('IDX_pulse_trades_userId', ['userId'])
@Index(
  'IDX_pulse_trades_user_clientRequestId_unique',
  ['userId', 'clientRequestId'],
  {
    unique: true,
    where: '"clientRequestId" IS NOT NULL',
  },
)
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_pulse_trades_user',
  })
  user: User;

  @Column({
    type: 'varchar',
    length: 255,
  })
  pair: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  direction: TradeDirection;

  @Column('int')
  duration: number;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  clientRequestId?: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  amount: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  entryPrice: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
    nullable: true,
  })
  exitPrice: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  result: TradeResult;

  @Column({
    type: 'varchar',
    length: 50,
    default: TradeStatus.CREATED,
  })
  status: TradeStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  expiryAt: Date;

  @Column({ nullable: true })
  settledAt: Date;

  @Column({
    type: 'int',
    default: 0,
  })
  settlementRetryCount: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  settlementFailureReason: string | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  lastSettlementAttemptAt: Date | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  nextSettlementRetryAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TradeSnapshot, (snapshot) => snapshot.trade)
  snapshots: TradeSnapshot[];
}
