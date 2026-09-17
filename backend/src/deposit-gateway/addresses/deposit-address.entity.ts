import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DepositAddressStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  RELEASED = 'RELEASED',
  /**
   * Custody hardening: this individual derived address is compromised.
   * Not reused for new allocations; sweep is suppressed; historical deposit
   * records are preserved. The master seed is NOT rotated for a single
   * compromised derived account.
   */
  COMPROMISED = 'COMPROMISED',
}

/**
 * A TradeX-owned deposit address. This is gateway infrastructure — it is NOT a
 * user's linked/auth wallet (that lives in the `wallets` table). Each active
 * order owns exactly one address so the gateway can map an on-chain transfer's
 * RECIPIENT back to a user + order without requiring a wallet signature.
 */
@Entity('deposit_addresses')
@Index('IDX_deposit_addresses_address_chainId_unique', ['address', 'chainId'], {
  unique: true,
})
@Index(
  'IDX_deposit_addresses_provider_chain_derivation_unique',
  ['provider', 'chainId', 'derivationIndex'],
  {
    unique: true,
    where: '"provider" IS NOT NULL AND "derivation_index" IS NOT NULL',
  },
)
@Index('IDX_deposit_addresses_user_chain_unique', ['userId', 'chainId'], {
  unique: true,
  where: '"user_id" IS NOT NULL',
})
export class DepositAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 64 })
  address: string;

  @Column({ name: 'chain_id' })
  chainId: number;

  @Index('IDX_deposit_addresses_userId')
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Index('IDX_deposit_addresses_orderId')
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider: string | null;

  @Column({ name: 'derivation_index', type: 'int', nullable: true })
  derivationIndex: number | null;

  @Column({ name: 'derivation_path', type: 'varchar', length: 128, nullable: true })
  derivationPath: string | null;

  /**
   * Custody generation/version. Addresses derived from the same master seed
   * share a generation. On a master-seed compromise the generation is bumped
   * (via CUSTODY_GENERATION env) so new addresses get a fresh generation
   * while old-generation addresses remain identifiable for historical records.
   */
  @Column({ name: 'custody_generation', type: 'int', default: 1 })
  custodyGeneration: number;

  @Index('IDX_deposit_addresses_status')
  @Column({ length: 32 })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
