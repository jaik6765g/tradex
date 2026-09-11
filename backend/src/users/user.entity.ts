import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  // ============================================================
  // UNIQUE USER ID
  // ============================================================

  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ============================================================
  // WALLET ADDRESS
  // ============================================================

  @Index('IDX_users_walletAddress_unique', { unique: true })
  @Column({
    type: 'varchar',
    length: 42,
  })
  walletAddress: string;

  // ============================================================
  // USER'S OWN REFERRAL CODE
  // ============================================================
  //
  // Example:
  // TDX12345
  //
  // Existing users can initially be null during migration.
  // New users will always receive a referral code.
  // ============================================================

  @Index('IDX_users_referralCode_unique', {
    unique: true,
    where: '"referralCode" IS NOT NULL',
  })
  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  referralCode: string | null;

  // ============================================================
  // REFERRER USER ID
  // ============================================================
  //
  // This stores the UID of the user who referred this user.
  //
  // Example:
  //
  // User A
  // id = AAA
  //
  // User B
  // referredBy = AAA
  // ============================================================

  @Column({
    type: 'uuid',
    nullable: true,
  })
  referredBy: string | null;

  @Index('IDX_users_referredBy')
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'referredBy',
    foreignKeyConstraintName: 'FK_users_referredBy',
  })
  referrer: User | null;

  // ============================================================
  // USER STATUS
  // ============================================================

  @Column({
    type: 'varchar',
    default: 'active',
  })
  status: string;

  // ============================================================
  // CREATED AT
  // ============================================================

  @CreateDateColumn()
  createdAt: Date;

  // ============================================================
  // UPDATED AT
  // ============================================================

  @UpdateDateColumn()
  updatedAt: Date;
}
