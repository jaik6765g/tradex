import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EligibleActivity {
  LOTTO = 'LOTTO',
  TRADE = 'TRADE',
  BOTH = 'BOTH',
}

@Entity('wagering_settings')
export class WageringSettings {
  /** Fixed singleton key — the DB CHECK restricts rows to this value only. */
  @PrimaryColumn({ name: 'singletonKey', type: 'integer' })
  singletonKey: number;

  @Column({ name: 'wageringEnabled', type: 'boolean', default: false })
  wageringEnabled: boolean;

  @Column({ name: 'defaultMultiplier', type: 'integer', default: 2 })
  defaultMultiplier: number;

  @Column({
    name: 'allowedMultipliers',
    type: 'integer',
    array: true,
    default: () => "'{1,2,3,5,10}'::integer[]",
  })
  allowedMultipliers: number[];

  @Column({
    name: 'eligibleActivity',
    type: 'varchar',
    length: 10,
    default: EligibleActivity.BOTH,
  })
  eligibleActivity: EligibleActivity;

  @Column({ name: 'withdrawalEnforcement', type: 'boolean', default: false })
  withdrawalEnforcement: boolean;

  @Column({ name: 'notifyUsers', type: 'boolean', default: true })
  notifyUsers: boolean;

  /** 0 = obligations never expire. */
  @Column({ name: 'expiryDays', type: 'integer', default: 0 })
  expiryDays: number;

  /**
   * Reconciliation look-back window in days.
   *   0  = UNLIMITED (no age cutoff) — sweeps all history since activation.
   *        It is NOT a way to disable reconciliation.
   *   >0 = only records newer than N days are swept.
   * Invalid values are coerced to 0 (unlimited) so the sweep can never be
   * accidentally turned off.
   */
  @Column({
    name: 'reconciliationMaxAgeDays',
    type: 'integer',
    default: 30,
  })
  reconciliationMaxAgeDays: number;

  /** Set when wageringEnabled first becomes true; deposits credited before this never create obligations. */
  @Column({ name: 'activationTimestamp', type: 'timestamptz', nullable: true })
  activationTimestamp: Date | null;

  /** Bumped on every settings change; snapshotted onto obligations/events. */
  @Column({ name: 'policyVersion', type: 'integer', default: 1 })
  policyVersion: number;

  @Column({ name: 'updatedBy', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamptz' })
  updatedAt: Date;
}