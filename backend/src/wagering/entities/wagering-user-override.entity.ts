import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('wagering_user_overrides')
@Index('UQ_wagering_user_overrides_user', ['userId'], { unique: true })
export class WageringUserOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'userId', type: 'uuid' })
  userId: string;

  @Column({ type: 'integer' })
  multiplier: number;

  /** Null means there was no prior override (global default applied before). */
  @Column({ name: 'previousValue', type: 'integer', nullable: true })
  previousValue: number | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'adminId', type: 'uuid' })
  adminId: string;

  /** Override applies only to obligations created at or after this time. */
  @Column({ name: 'appliedFrom', type: 'timestamptz' })
  appliedFrom: Date;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt', type: 'timestamptz' })
  updatedAt: Date;
}