import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tdx_balances')
@Index(['userId'], { unique: true })
export class TdxBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  available: string;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  locked: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
