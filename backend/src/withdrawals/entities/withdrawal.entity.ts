// src/withdrawals/entities/withdrawal.entity.ts

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WithdrawalStatus {
  REQUESTED = 'REQUESTED',
  RISK_CHECKING = 'RISK_CHECKING',
  LIQUIDITY_CHECK = 'LIQUIDITY_CHECK',
  PENDING_ADMIN_APPROVAL = 'PENDING_ADMIN_APPROVAL',

  // Admin approved payout. TDX locked until blockchain payout verified.
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',

  // Backward compatibility with existing DB/data.
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  HOLD = 'HOLD',
}

@Entity('withdrawals')
@Index('IDX_withdrawals_user_createdAt', ['userId', 'createdAt'])
@Index('IDX_withdrawals_txHash', ['txHash'])
@Index('IDX_withdrawals_user_status', ['userId', 'status'])
@Index('IDX_withdrawals_status', ['status'])
/**
 * One payout idempotency key may belong to at most one withdrawal. The
 * migration for this index first scans for duplicates and moves the key of
 * later duplicates into `metadata.payoutIdempotencyKeyDuplicate` (financial
 * records are never deleted), so the constraint can be added safely.
 */
@Index('IDX_withdrawals_payoutIdempotencyKey_unique', ['payoutIdempotencyKey'], {
  unique: true,
  where: '"payoutIdempotencyKey" IS NOT NULL',
})
/**
 * User-scoped client request idempotency anchor: replaying the same
 * clientRequestId can never create a second withdrawal.
 */
@Index(
  'IDX_withdrawals_user_clientRequestId_unique',
  ['userId', 'clientRequestId'],
  { unique: true, where: '"clientRequestId" IS NOT NULL' },
)
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /**
   * Optional user-scoped idempotency key supplied by the client. The same
   * (userId, clientRequestId) can only ever create ONE withdrawal; replays
   * return the original result. NULL for requests that did not supply one.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  clientRequestId?: string;

  @Column({ type: 'varchar', length: 42 })
  walletAddress: string;

  @Column({ type: 'int' })
  chainId: number;

  @Column({ type: 'varchar', length: 42 })
  tokenAddress: string;

  @Column({ type: 'numeric', precision: 36, scale: 18 })
  tdxAmount: string;

  @Column({ type: 'numeric', precision: 36, scale: 18 })
  usdtAmount: string;

  @Column({ type: 'numeric', precision: 36, scale: 18, default: '0' })
  fee: string;

  @Column({ type: 'varchar', length: 40, default: WithdrawalStatus.REQUESTED })
  status: WithdrawalStatus;

  @Column({ type: 'boolean', default: false })
  riskPassed: boolean;

  @Column({ type: 'boolean', default: false })
  liquidityPassed: boolean;

  @Column({ type: 'boolean', default: false })
  adminApproved: boolean;

  @Column({ type: 'uuid', nullable: true })
  approvedBy?: string;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  txHash?: string;

  // Backend never receives/stores private key.
  @Column({ type: 'varchar', length: 42, nullable: true })
  payoutWalletAddress?: string;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata?: Record<string, unknown>;

  /* ================= PAYOUT FIELDS ================= */

  @Column({ type: 'boolean', default: false })
  payoutAttempted: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  payoutIdempotencyKey?: string;

  @Column({ type: 'timestamp', nullable: true })
  payoutSubmittedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  payoutConfirmedAt?: Date;

  /* ================================================= */

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ type: 'text', nullable: true })
  riskReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
