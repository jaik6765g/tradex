import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/user.entity';
import { BotWallet } from './bot-wallet.entity';

export enum BotAccountStatus {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
}

@Entity('bot_accounts')
@Index('UQ_bot_accounts_user_id', ['userId'], { unique: true })
@Index('UQ_bot_accounts_bot_id', ['botId'], { unique: true })
export class BotAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'user_id',
    type: 'uuid',
  })
  userId: string;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_bot_accounts_user',
  })
  user: User;

  @Column({
    name: 'bot_id',
    type: 'varchar',
    length: 32,
  })
  botId: string;

  @Column({
    type: 'enum',
    enum: BotAccountStatus,
    default: BotAccountStatus.INACTIVE,
  })
  status: BotAccountStatus;

  @Column({
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  principal: string;

  @Column({
    name: 'activated_at',
    type: 'timestamptz',
    nullable: true,
  })
  activatedAt: Date | null;

  @Column({
    name: 'suspended_at',
    type: 'timestamptz',
    nullable: true,
  })
  suspendedAt: Date | null;

  @Column({
    name: 'closed_at',
    type: 'timestamptz',
    nullable: true,
  })
  closedAt: Date | null;

  @OneToOne(() => BotWallet, (botWallet) => botWallet.botAccount)
  botWallet: BotWallet;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;
}
