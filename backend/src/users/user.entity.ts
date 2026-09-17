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
    nullable: true,
  })
  walletAddress: string | null;

  // ============================================================
  // MOBILE NUMBER (E.164) — primary login identity
  // ============================================================

  @Index('IDX_users_mobileNumber_unique', { unique: true })
  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  mobileNumber: string | null;

  // ============================================================
  // EMAIL ADDRESS — internal identity for Supabase email/password
  // ============================================================

  @Index('IDX_users_email_unique', { unique: true })
  @Column({
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  email: string | null;

  // ============================================================
  // SUPABASE AUTH USER ID
  // ============================================================

  @Index('IDX_users_authUserId_unique', { unique: true })
  @Column({
    type: 'uuid',
    nullable: true,
  })
  authUserId: string | null;

  // ============================================================
  // APPLICATION ROLE
  // ============================================================

  @Column({
    type: 'varchar',
    length: 20,
    default: 'user',
  })
  role: string;

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
