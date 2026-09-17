import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only audit trail for custody emergency actions.
 *
 * SECURITY: this table NEVER stores secrets (no mnemonic, seed, private key,
 * raw secret). It records WHO did WHAT, WHEN, for which address/network, and
 * the RESULT — safe operational metadata only.
 */
@Entity('custody_audit_logs')
export class CustodyAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  /** e.g. ADDRESS_COMPROMISED, CUSTODY_LOCKDOWN, CUSTODY_RECOVERY, ADDRESS_RECOVERY */
  @Index('IDX_custody_audit_logs_action')
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  network: string | null;

  @Index('IDX_custody_audit_logs_address')
  @Column({ type: 'varchar', length: 64, nullable: true })
  address: string | null;

  @Column({ name: 'deposit_address_id', type: 'uuid', nullable: true })
  depositAddressId: string | null;

  @Column({ name: 'custody_generation', type: 'int', nullable: true })
  custodyGeneration: number | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Index()
  @Column({ name: 'result', type: 'varchar', length: 32 })
  result: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 64, nullable: true })
  correlationId: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Index('IDX_custody_audit_logs_createdAt')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
