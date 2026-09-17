import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DepositSweepStatus {
  PENDING = 'PENDING',
  GAS_REQUIRED = 'GAS_REQUIRED',
  /**
   * Signed + deterministic tx hash persisted, broadcast not yet confirmed.
   * Intermediate state that survives crashes: recovery can safely rebroadcast
   * the SAME signed raw tx (idempotent — same hash) or poll for the hash.
   */
  BROADCASTING = 'BROADCASTING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMING = 'CONFIRMING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/**
 * A sweep moves received funds from a deposit address to the secure treasury
 * wallet. One sweep per deposit (deposit_id UNIQUE) guarantees a confirmed
 * deposit is never swept twice.
 */
@Entity('deposit_sweeps')
export class DepositSweep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_deposit_sweeps_depositId_unique')
  @Column({ name: 'deposit_id', type: 'uuid', unique: true, nullable: true })
  depositId: string | null;

  @Index('IDX_deposit_sweeps_depositAddressId')
  @Column({ name: 'deposit_address_id', type: 'uuid', nullable: true })
  depositAddressId: string | null;

  @Column({ name: 'chain_id' })
  chainId: number;

  @Column({ name: 'asset_symbol', length: 32 })
  assetSymbol: string;

  @Column({ name: 'token_address', length: 42 })
  tokenAddress: string;

  @Column({ name: 'amount', type: 'numeric', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'destination_address', length: 42 })
  destinationAddress: string;

  @Index('IDX_deposit_sweeps_status')
  @Column({ length: 32 })
  status: string;

  @Column({ name: 'sweep_tx_hash', type: 'varchar', length: 66, nullable: true })
  sweepTxHash: string | null;

  /**
   * Signed raw transaction (hex). Stored at BROADCASTING time so the sweep can
   * be recovered idempotently after a crash: re-broadcasting the same signed
   * raw tx yields the same EVM tx hash (keccak256), so it can never produce a
   * second, different transaction. NULL for legacy sweeps.
   */
  @Column({ name: 'signed_tx_raw', type: 'text', nullable: true })
  signedTxRaw: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
