import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('wallets')
@Index('IDX_wallets_address_chainId_unique', ['address', 'chainId'], {
  unique: true,
})
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_wallets_address')
  @Column({ length: 42 })
  address: string;

  @Index('IDX_wallets_chainId')
  @Column()
  chainId: number;

  @Column({ default: true })
  isPrimary: boolean;

  @Index('IDX_wallets_userId')
  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
