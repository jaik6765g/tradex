// backend/src/lotto/entities/lotto-result.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LottoRound } from './lotto-round.entity';
import { User } from '../../../users/user.entity';

export enum ResultSource {
  SERVER = 'SERVER',
  ADMIN = 'ADMIN',
}

export enum ResultStatus {
  GENERATED = 'GENERATED',
  FINALIZED = 'FINALIZED',
}

@Entity('lotto_results')
@Index(['roundId'])
export class LottoResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  roundId: number;

  @Column({ length: 1 })
  result: string; // 0-F

  @Column({
    type: 'enum',
    enum: ResultSource,
    default: ResultSource.SERVER,
  })
  source: ResultSource;

  @Column({ type: 'uuid', nullable: true })
  adminId: string | null;

  @Column({
    type: 'enum',
    enum: ResultStatus,
    default: ResultStatus.GENERATED,
  })
  status: ResultStatus;

  @CreateDateColumn()
  generatedAt: Date;

  @Column({ nullable: true, type: 'timestamp' })
  finalizedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @ManyToOne(() => LottoRound)
  @JoinColumn({ name: 'roundId' })
  round: LottoRound;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'adminId' })
  admin: User;
}
