import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('auth_nonces')
export class AuthNonce {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_auth_nonces_walletAddress')
  @Column({ length: 42 })
  walletAddress: string;

  @Column({ length: 128 })
  nonce: string;

  @Column()
  expiresAt: Date;

  @Column({ default: false })
  used: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
