import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { EligibleActivity } from './wagering-settings.entity';

export enum WageringObligationStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

@Entity('wagering_obligations')
@Index('UQ_wagering_obligations_deposit', ['depositId'], { unique: true })
@Index('IDX_wagering_obligations_user_status', ['userId', 'status'])
export class WageringObligation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'userId', type: 'uuid' })
  userId: string;

  @Column({ name: 'depositId', type: 'uuid' })
  depositId: string;

  @Column({ name: 'ledgerEntryId', type: 'uuid' })
  ledgerEntryId: string;

  // --- Creation-time snapshots (never recalculated) ---

  @Column({ name: 'sourceUsdtAmount', type: 'numeric', precision: 36, scale: 18 })
  sourceUsdtAmount: string;

  @Column({ name: 'sourceTdxAmount', type: 'numeric', precision: 36, scale: 18 })
  sourceTdxAmount: string;

  @Column({ name: 'conversionRate', type: 'numeric', precision: 36, scale: 18 })
  conversionRate: string;

  @Column({
    name: 'depositAmountTdx',
    type: 'numeric',
    precision: 36,
    scale: 18,
  })
  depositAmountTdx: string;

  @Column({ type: 'integer' })
  multiplier: number;

  @Column({ name: 'requiredAmount', type: 'numeric', precision: 36, scale: 18 })
  requiredAmount: string;

  @Column({
    name: 'completedAmount',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  completedAmount: string;

  @Column({
    type: 'varchar',
    length: 12,
    default: WageringObligationStatus.ACTIVE,
  })
  status: WageringObligationStatus;

  @Column({ name: 'policyVersion', type: 'integer' })
  policyVersion: number;

  @Column({
    name: 'eligibleActivity',
    type: 'varchar',
    length: 10,
  })
  eligibleActivity: EligibleActivity;

  @Column({ name: 'expiresAt', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'cancelledReason', type: 'text', nullable: true })
  cancelledReason: string | null;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'completedAt', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}