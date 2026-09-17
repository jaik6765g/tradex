import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BscGasTransferStatus {
  PENDING = 'PENDING',
  BROADCASTING = 'BROADCASTING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/**
 * One BNB funding transfer inside a BscGasBatch.
 * Deterministic identity: (batch_id, recipient) UNIQUE — a retry of the same
 * batch can never create a duplicate transfer row; recovery updates the row.
 * Never stores private keys or signed raw transactions.
 */
@Entity('bsc_gas_transfers')
@Index('IDX_bsc_gas_transfers_batch_recipient_unique', ['batchId', 'recipient'], { unique: true })
export class BscGasTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_bsc_gas_transfers_batchId')
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Index('IDX_bsc_gas_transfers_recipient')
  @Column({ type: 'varchar', length: 64 })
  recipient: string;

  /** BNB amount (decimal string, 18dp). */
  @Column({ type: 'numeric', precision: 36, scale: 18 })
  amountBnb: string;

  /** BNB amount in wei (bigint string) — exact on-chain value. */
  @Column({ name: 'amount_wei', type: 'numeric', precision: 78, scale: 0 })
  amountWei: string;

  @Index('IDX_bsc_gas_transfers_status')
  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
  txHash: string | null;

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber: number | null;

  @Column({ name: 'confirmations', type: 'int', default: 0 })
  confirmations: number;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
