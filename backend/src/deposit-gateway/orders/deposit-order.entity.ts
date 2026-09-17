import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/user.entity';

// Order lifecycle: CREATED -> AWAITING_PAYMENT -> DETECTED -> CONFIRMING
// -> CONFIRMED -> COMPLETED. Terminal/exceptional states: UNDERPAID, EXPIRED,
// FAILED, CANCELLED.
export enum DepositOrderStatus {
  CREATED = 'CREATED',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  DETECTED = 'DETECTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  UNDERPAID = 'UNDERPAID',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('deposit_orders')
export class DepositOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_deposit_orders_userId')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'chain_id' })
  chainId: number;

  @Column({ name: 'asset_symbol', length: 32 })
  assetSymbol: string;

  @Column({ name: 'token_address', length: 42 })
  tokenAddress: string;

  @Column({ name: 'amount', type: 'numeric', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'expected_tdx', type: 'numeric', precision: 36, scale: 18 })
  expectedTdx: string;

  @Index('IDX_deposit_orders_status')
  @Column({ length: 32 })
  status: string;

  @Column({ name: 'deposit_address_id', type: 'uuid', nullable: true })
  depositAddressId: string | null;

  @Index('IDX_deposit_orders_expiresAt')
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
