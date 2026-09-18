import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WageringNotificationKind {
  OBLIGATION_CREATED = 'OBLIGATION_CREATED',
  OBLIGATION_COMPLETED = 'OBLIGATION_COMPLETED',
  OVERRIDE_APPLIED = 'OVERRIDE_APPLIED',
}

@Entity('wagering_notifications')
@Index('IDX_wagering_notifications_user', ['userId', 'createdAt'])
export class WageringNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'userId', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  kind: WageringNotificationKind;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ name: 'readAt', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'createdAt', type: 'timestamptz' })
  createdAt: Date;
}