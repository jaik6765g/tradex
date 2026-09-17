import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';

export enum DepositStatus {
  PENDING = 'PENDING',
  CONFIRMING = 'CONFIRMING',
  VERIFIED = 'VERIFIED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('deposits')
export class Deposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'wallet_id', type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'deposit_address', type: 'varchar', length: 64, nullable: true })
  depositAddress: string | null;

  @Column({ name: 'chain_id' })
  chainId: number;

  @Column({ name: 'transaction_hash', length: 128, unique: true })
  transactionHash: string;

  @Column({ name: 'block_number', type: 'bigint' })
  blockNumber: number;

  @Column({ name: 'block_timestamp', type: 'timestamp' })
  blockTimestamp: Date;

  @Column({ name: 'vault_address', length: 64 })
  vaultAddress: string;

  @Column({ name: 'sender_address', length: 64 })
  senderAddress: string;

  @Column({ name: 'amount', length: 78 })
  amount: string;

  @Column({ name: 'usdt_amount', type: 'decimal', precision: 36, scale: 18 })
  usdtAmount: string;

  @Column({ name: 'tdx_amount', type: 'decimal', precision: 36, scale: 18 })
  tdxAmount: string;

  @Column({ default: 0 })
  confirmations: number;

  @Column({ name: 'required_confirmations', default: 15 })
  requiredConfirmations: number;

  @Column({
    type: 'enum',
    enum: DepositStatus,
    default: DepositStatus.PENDING,
  })
  status: DepositStatus;

  @Column({ name: 'detected_at', type: 'timestamp', default: () => 'NOW()' })
  detectedAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true })
  confirmedAt: Date;

  @Column({ name: 'credited_at', type: 'timestamp', nullable: true })
  creditedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Wallet, { nullable: true })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet | null;
}
