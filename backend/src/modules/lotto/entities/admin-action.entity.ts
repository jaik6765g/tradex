// backend/src/lotto/entities/admin-action.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../../users/user.entity';
import { LottoRound } from './lotto-round.entity';

@Entity('admin_actions')
@Index(['adminId'])
@Index(['action'])
@Index(['createdAt'])
export class AdminAction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  adminId: string;

  @Column({ length: 50 })
  action: string;

  @Column({ length: 50 })
  targetType: string;

  @Column()
  targetId: number;

  @Column({ type: 'jsonb', nullable: true })
  oldValue: any;

  @Column({ type: 'jsonb', nullable: true })
  newValue: any;

  @Column({ length: 45, nullable: true })
  ipAddress: string;

  @Column({ length: 255, nullable: true })
  userAgent: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'adminId' })
  admin: User;

  @ManyToOne(() => LottoRound, (round) => round.adminActions)
  @JoinColumn({ name: 'targetId' })
  round: LottoRound;
}
