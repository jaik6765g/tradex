// backend/src/modules/period-sync/wingo-period.entity.ts
import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WingoPeriodStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum WingoSyncStatus {
  SYNCED = 'SYNCED',
  SYNC_DEGRADED = 'SYNC_DEGRADED',
  SYNC_ERROR = 'SYNC_ERROR',
}

/**
 * Persists the authoritative WinGo 30-second period state as reported by the
 * external TPPLAY reference. The period number NEVER originates here — it is
 * always copied from the reference source. This table is durability only; the
 * authoritative live value is kept in memory by PeriodSyncService.
 */
@Entity('wingo_periods')
@Index('IDX_wingo_periods_end_time', ['endTime'])
export class WingoPeriod {
  /** Authoritative period/issue number from the reference (e.g. 20260914100050657). */
  @PrimaryColumn({ length: 30 })
  periodNumber: string;

  @Column({ length: 30, default: 'WinGo_30S' })
  gameCode: string;

  @Column({ type: 'bigint' })
  startTime: string; // epoch ms

  @Column({ type: 'bigint' })
  endTime: string; // epoch ms

  @Column({ type: 'varchar', length: 30, nullable: true })
  previousPeriodNumber: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  nextPeriodNumber: string | null;

  @Column({
    type: 'enum',
    enum: WingoPeriodStatus,
    default: WingoPeriodStatus.OPEN,
  })
  status: WingoPeriodStatus;

  @Column({
    type: 'enum',
    enum: WingoSyncStatus,
    default: WingoSyncStatus.SYNCED,
  })
  syncStatus: WingoSyncStatus;

  @Column({ type: 'bigint', nullable: true })
  lastSyncedAt: string | null; // epoch ms

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
