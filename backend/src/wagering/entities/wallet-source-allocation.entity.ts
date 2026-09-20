// src/wagering/entities/wallet-source-allocation.entity.ts
// ============================================================
// FIFO FUND-SOURCE ATTRIBUTION (withdrawal-eligibility layer ONLY)
// ============================================================
//
// This table does NOT hold spendable money and is NOT a second balance
// system. `balances` + `ledger_entries` remain the only financial source of
// truth. Each row is an *attribution record* for one credited amount:
//
//   available(bucket) = originalAmount - consumedAmount - reservedAmount
//
// Invariant maintained by the services and by the DB CHECK below:
//
//   SUM(available of ACTIVE buckets) <= balances.available_balance
//
// Reconciliation detects (never silently rewrites) any mismatch.
// ============================================================

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WalletSourceAllocationStatus {
  /** Bucket still has unattributed capacity. */
  ACTIVE = 'ACTIVE',
  /** Fully consumed/reserved — originalAmount == consumed + reserved. */
  EXHAUSTED = 'EXHAUSTED',
  /**
   * Explicitly voided by an authorized admin/reconciliation action
   * (refund/reversal/cancellation repair). Never deleted — financial
   * history is preserved.
   */
  VOID = 'VOID',
}

@Entity('wallet_source_allocations')
@Index('UQ_wallet_source_allocations_source', ['sourceId'], { unique: true })
@Index('IDX_wallet_source_allocations_fifo', [
  'userId',
  'status',
  'createdAt',
])
export class WalletSourceAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_wallet_source_allocations_user')
  @Column({ name: 'userId', type: 'uuid' })
  userId: string;

  /** DEPOSIT | BONUS | REFERRAL_COMMISSION | SALARY | LEGACY | OTHER */
  @Column({ name: 'sourceType', type: 'varchar', length: 30 })
  sourceType: string;

  /**
   * Stable identity of the originating credit — the ledger entry id for
   * ledger-backed credits, or a deterministic synthetic key. UNIQUE, so a
   * replayed credit can never create a second bucket (idempotency anchor).
   */
  @Column({ name: 'sourceId', type: 'varchar', length: 128 })
  sourceId: string;

  /** Ledger entry that evidences this credit (nullable for LEGACY rows). */
  @Column({ name: 'ledgerEntryId', type: 'uuid', nullable: true })
  ledgerEntryId: string | null;

  /** Snapshot of the policy classification at credit time (never recomputed). */
  @Column({ name: 'wagerable', type: 'boolean' })
  wagerable: boolean;

  @Column({ name: 'originalAmount', type: 'numeric', precision: 36, scale: 18 })
  originalAmount: string;

  @Column({
    name: 'consumedAmount',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  consumedAmount: string;

  @Column({
    name: 'reservedAmount',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  reservedAmount: string;

  @Column({
    type: 'varchar',
    length: 12,
    default: WalletSourceAllocationStatus.ACTIVE,
  })
  status: WalletSourceAllocationStatus;

  /** Immutable creation-time snapshot for audit (source policy version etc.). */
  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamptz' })
  updatedAt: Date;
}