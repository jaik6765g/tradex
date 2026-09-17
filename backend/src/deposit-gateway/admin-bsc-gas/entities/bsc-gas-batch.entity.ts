import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BscGasBatchStatus {
  CREATED = 'CREATED',
  PREVIEW = 'PREVIEW',
  BROADCASTING = 'BROADCASTING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/**
 * Admin-confirmed BNB funding batch.
 * Append-only operational record — NEVER stores secrets (no private keys,
 * mnemonics, signed raw tx of the custody seed). Gas-wallet signed raw tx
 * hashes are tracked per-transfer via BscGasTransfer; raw tx is NOT persisted.
 */
@Entity('bsc_gas_batches')
export class BscGasBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chain_id', type: 'int', default: 56 })
  chainId: number;

  @Index('IDX_bsc_gas_batches_status')
  @Column({ type: 'varchar', length: 32 })
  status: string;

  /** Total BNB (decimal string, 18dp) across all transfers. */
  @Column({ name: 'total_bnb', type: 'numeric', precision: 36, scale: 18 })
  totalBnb: string;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount: number;

  /** Idempotency key supplied by the admin client (batch-preview token). */
  @Index('IDX_bsc_gas_batches_idempotency_unique', { unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  /** Gas wallet address used (public address only — never the key). */
  @Column({ name: 'gas_wallet_address', type: 'varchar', length: 64, nullable: true })
  gasWalletAddress: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
