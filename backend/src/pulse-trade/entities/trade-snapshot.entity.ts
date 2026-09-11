import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Trade } from './trade.entity';

@Entity('pulse_trade_snapshots')
export class TradeSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tradeId: string;

  @ManyToOne(() => Trade, (trade) => trade.snapshots, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tradeId',
    foreignKeyConstraintName: 'FK_pulse_snapshots_trade',
  })
  trade: Trade;

  @Column({
    type: 'varchar',
    length: 255,
  })
  symbol: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  price: string;

  @CreateDateColumn()
  timestamp: Date;
}
