import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Persists the last-processed cursor per chain so the deposit watcher resumes
 * from PostgreSQL (the source of truth) after a restart instead of relying on
 * in-memory state, which would risk missing deposits.
 *
 * EVM watchers use lastProcessedBlock; the TRON watcher uses
 * lastProcessedTimestamp (TronGrid paginates TRC-20 transfers by ms timestamp).
 */
@Entity('gateway_watcher_state')
export class GatewayWatcherState {
  @PrimaryColumn({ name: 'chain_id' })
  chainId: number;

  @Column({ name: 'last_processed_block', type: 'bigint', default: 0 })
  lastProcessedBlock: number;

  @Column({ name: 'last_processed_timestamp', type: 'bigint', nullable: true })
  lastProcessedTimestamp: number | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
