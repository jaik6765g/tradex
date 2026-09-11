import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { BotAccount } from './bot-account.entity';

@Entity('bot_wallets')
@Index('IDX_bot_wallets_botAccountId_unique', ['botAccountId'], {
  unique: true,
})
export class BotWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * One Bot Account = One Bot Wallet.
   */
  @Column({
    name: 'bot_account_id',
    type: 'uuid',
  })
  botAccountId: string;

  @OneToOne(() => BotAccount, (botAccount) => botAccount.botWallet)
  @JoinColumn({
    name: 'bot_account_id',
    foreignKeyConstraintName: 'FK_bot_wallets_bot_account',
  })
  botAccount: BotAccount;

  /**
   * Available TDX balance.
   *
   * NUMERIC is used instead of float/double
   * for financial precision.
   */
  @Column({
    name: 'available_balance',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  availableBalance: string;

  /**
   * Funds currently locked for active bot operations.
   */
  @Column({
    name: 'locked_balance',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  lockedBalance: string;

  /**
   * Total balance:
   *
   * available + locked
   *
   * This can also be calculated, but keeping it
   * here makes dashboard reads cheaper.
   */
  @Column({
    name: 'total_balance',
    type: 'numeric',
    precision: 36,
    scale: 18,
    default: '0',
  })
  totalBalance: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
  })
  updatedAt: Date;
}
