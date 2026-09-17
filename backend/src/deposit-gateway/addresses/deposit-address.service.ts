import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, DataSource, type EntityManager, type Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { DepositAddress, DepositAddressStatus } from './deposit-address.entity';
import { DepositOrder, DepositOrderStatus } from '../orders/deposit-order.entity';
import {
  DEPOSIT_ADDRESS_PROVIDER,
  type DepositAddressProvider,
  type GeneratedDepositAddress,
} from './deposit-address-provider.interface';
import {
  isAllocationAllowed,
  normalizeCustodyGeneration,
  normalizeCustodyState,
  CUSTODY_STATE_ENV_KEY,
  CUSTODY_GENERATION_ENV_KEY,
} from '../custody/custody-state';

@Injectable()
export class DepositAddressService {
  constructor(
    @InjectRepository(DepositAddress)
    private readonly repo: Repository<DepositAddress>,
    private readonly dataSource: DataSource,
    @Inject(DEPOSIT_ADDRESS_PROVIDER)
    private readonly provider: DepositAddressProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Orders in these statuses are open / not yet terminal; they are the only
   * orders that can be safely cancelled when their deposit address is released
   * because it became ineligible (legacy/dev/EXPIRED/COMPROMISED).
   */
  private static readonly NON_TERMINAL_ORDER_STATUSES: string[] = [
    DepositOrderStatus.CREATED,
    DepositOrderStatus.AWAITING_PAYMENT,
    DepositOrderStatus.DETECTED,
    DepositOrderStatus.CONFIRMING,
    DepositOrderStatus.CONFIRMED,
  ];

  /**
   * An existing deposit address may ONLY be reused for a new order when it is a
   * healthy self-custody address:
   *   - status = ACTIVE
   *   - provider matches the active custody provider
   *   - derivation_index + derivation_path are present (no legacy records)
   *   - custody_generation matches the current custody generation
   *
   * Legacy/dev addresses (NULL provider, NULL derivation metadata, EXPIRED,
   * COMPROMISED, RELEASED or old generation) are NEVER eligible for reuse.
   */
  async isEligibleForReuse(
    addr: DepositAddress,
    generation: number,
  ): Promise<boolean> {
    return (
      addr.status === DepositAddressStatus.ACTIVE &&
      addr.provider === this.provider.name &&
      addr.derivationIndex !== null &&
      Number.isInteger(addr.derivationIndex) &&
      addr.derivationIndex >= 0 &&
      typeof addr.derivationPath === 'string' &&
      addr.derivationPath.length > 0 &&
      addr.custodyGeneration === generation
    );
  }

  /** If the address itself cannot be derived, treat as ineligible. */
  private async isDerivable(
    chainId: number,
    derivationIndex: number,
    expectedAddress: string,
  ): Promise<boolean> {
    try {
      const generated = await this.provider.generateAddress({
        chainId,
        derivationIndex,
      });
      return (
        generated.address.toLowerCase() === expectedAddress.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  /**
   * A derived deposit address must NEVER equal a configured treasury. Checks the
   * per-network treasury env keys plus the generic deposit treasury.
   */
  private isTreasuryCollision(address: string): boolean {
    const candidates: string[] = [
      'BSC_TREASURY_ADDRESS',
      'POLYGON_TREASURY_ADDRESS',
      'ARBITRUM_TREASURY_ADDRESS',
      'TRON_TREASURY_ADDRESS',
      'SOLANA_TREASURY_ADDRESS',
      'DEPOSIT_TREASURY_ADDRESS',
    ]
      .map((key) => (this.configService.get<string>(key) ?? '').trim())
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase());
    return candidates.includes(address.toLowerCase());
  }

  /**
   * Allocate a unique deposit address within the caller's transaction.
   * Uses a Postgres advisory lock so concurrent orders cannot reuse the same
   * derivation index; the unique (provider, chain, derivationIndex) index is
   * an additional DB-level backstop.
   *
   * Reuse rule: an existing USER + NETWORK address is reused ONLY if it is an
   * eligible self-custody address. A legacy/dev/EXPIRED/COMPROMISED address is
   * released (record preserved, user binding removed) and a fresh self-custody
   * address is allocated instead — an ineligible address is NEVER returned.
   */
  async allocateWithManager(
    manager: EntityManager,
    input: { chainId: number; userId: string; orderId: string },
  ): Promise<DepositAddress> {
    // Custody hardening: block new allocation unless state is NORMAL.
    const state = normalizeCustodyState(
      this.configService.get<string>(CUSTODY_STATE_ENV_KEY),
    );
    if (!isAllocationAllowed(state)) {
      throw new Error(
        `Deposit address allocation denied: custody state is ${state}`,
      );
    }

    const generation = normalizeCustodyGeneration(
      this.configService.get<string>(CUSTODY_GENERATION_ENV_KEY),
    );

    const addrRepo = manager.getRepository(DepositAddress);
    const orderRepo = manager.getRepository(DepositOrder);

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`deposit-address-alloc:${this.provider.name}`],
    );

    // Reuse rule: existing USER + NETWORK address is reused ONLY if it is an
    // eligible self-custody address. A legacy/dev/EXPIRED/COMPROMISED address
    // is released below and a fresh self-custody address is allocated instead.
    const existing = await addrRepo.findOne({
      where: { userId: input.userId, chainId: input.chainId },
    });

    if (
      existing &&
      (await this.isEligibleForReuse(existing, generation)) &&
      (await this.isDerivable(
        existing.chainId,
        existing.derivationIndex as number,
        existing.address,
      ))
    ) {
      if (existing.orderId !== input.orderId) {
        existing.orderId = input.orderId;
        await addrRepo.save(existing);
      }
      return existing;
    }

    // Ineligible existing record (legacy/dev/EXPIRED/COMPROMISED/missing
    // derivation metadata/mismatched provider or generation): release it so the
    // unique (provider, chain, derivationIndex) constraint allows a fresh row.
    // The historical record itself is preserved (address + provider + derivation
    // metadata are NOT rewritten); status becomes RELEASED so it can never be
    // presented as a new deposit destination. COMPROMISED records keep their
    // COMPROMISED marker for audit and are detached from the active user binding.
    if (existing) {
      existing.userId = null;
      existing.orderId = null;
      if (existing.status !== DepositAddressStatus.COMPROMISED) {
        existing.status = DepositAddressStatus.RELEASED;
      }
      await addrRepo.save(existing);

      // Cancel any open orders that reference the now-ineligible address so a
      // user can never be instructed to pay the legacy/expired address again.
      if (existing.id) {
        await orderRepo.update(
          {
            depositAddressId: existing.id,
            status: In(
              DepositAddressService.NON_TERMINAL_ORDER_STATUSES,
            ),
          },
          { status: DepositOrderStatus.CANCELLED },
        );
      }
    }

    let nextIndex = await this.nextDerivationIndex(
      manager,
      this.provider.name,
    );

    // Treasury-collision guard: a derived deposit address must NEVER equal a
    // configured treasury. If the next index collides, skip to the next index.
    let generated: GeneratedDepositAddress;
    let guardCount = 0;
    do {
      if (guardCount > 1000) {
        throw new Error(
          'Deposit address allocation failed: derivation indices collide with configured treasury',
        );
      }
      generated = await this.provider.generateAddress({
        chainId: input.chainId,
        derivationIndex: nextIndex,
      });
      nextIndex += 1;
      guardCount += 1;
    } while (this.isTreasuryCollision(generated.address));

    const entity = addrRepo.create({
      address: generated.address,
      chainId: input.chainId,
      userId: input.userId,
      orderId: input.orderId,
      provider: generated.provider,
      derivationIndex: generated.derivationIndex,
      derivationPath: generated.derivationPath,
      custodyGeneration: generation,
      status: DepositAddressStatus.ACTIVE,
    });

    return addrRepo.save(entity);
  }

  /** Reuse an existing derivation index only if its address is not compromised. */
  async findUnusedIndexForChain(
    manager: EntityManager,
    chainId: number,
    provider: string,
  ): Promise<number> {
    const row = await manager
      .getRepository(DepositAddress)
      .createQueryBuilder('a')
      .select('MAX(a.derivationIndex)', 'max')
      .where('a.provider = :provider', { provider })
      .andWhere('a.status != :compromised', {
        compromised: DepositAddressStatus.COMPROMISED,
      })
      .getRawOne<{ max: number | null }>();
    return (row?.max ?? -1) + 1;
  }

  private async nextDerivationIndex(
    manager: EntityManager,
    provider: string,
  ): Promise<number> {
    // Global counter per provider (NOT per chain) so two networks can never
    // derive the same HD child key (cross-network address collision safety).
    const row = await manager
      .getRepository(DepositAddress)
      .createQueryBuilder('a')
      .select('MAX(a.derivationIndex)', 'max')
      .where('a.provider = :provider', { provider })
      .getRawOne<{ max: number | null }>();

    return (row?.max ?? -1) + 1;
  }

  validateAddress(address: string, chainId: number): boolean {
    return this.provider.validateAddress(address, chainId);
  }

  getMetadata(address: string, chainId: number): Record<string, unknown> {
    return this.provider.getAddressMetadata(address, chainId);
  }

  isDevelopment(): boolean {
    return this.provider.isDevelopment();
  }

  providerName(): string {
    return this.provider.name;
  }

  async findByAddressAndChainId(
    address: string,
    chainId: number,
  ): Promise<DepositAddress | null> {
    return this.repo.findOne({ where: { address, chainId } });
  }

  /**
   * All user-assigned addresses on a chain are "watchable" under the
   * one-address-per-user model. Status (ACTIVE/COMPLETED/EXPIRED) is
   * informational only and must NOT exclude an address from watching.
   */
  async findActiveByChain(chainId: number): Promise<DepositAddress[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.chainId = :chainId', { chainId })
      .andWhere('a.user_id IS NOT NULL')
      .getMany();
  }

  async findByOrderId(orderId: string): Promise<DepositAddress | null> {
    return this.repo.findOne({ where: { orderId } });
  }

  async findById(id: string): Promise<DepositAddress | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByUserAndChain(
    userId: string,
    chainId: number,
  ): Promise<DepositAddress | null> {
    return this.repo.findOne({ where: { userId, chainId } });
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.repo.update({ id }, { status });
  }

  /**
   * Mark an individual derived address COMPROMISED. Preserves all historical
   * records; does not rotate the master seed. Returns the updated entity.
   */
  async markCompromised(id: string): Promise<DepositAddress> {
    const addr = await this.repo.findOne({ where: { id } });
    if (!addr) throw new Error('Deposit address not found');
    addr.status = DepositAddressStatus.COMPROMISED;
    return this.repo.save(addr);
  }

  /** True if the address with this id is currently COMPROMISED. */
  async isCompromised(id: string): Promise<boolean> {
    const addr = await this.repo.findOne({
      where: { id },
      select: { status: true },
    });
    return addr?.status === DepositAddressStatus.COMPROMISED;
  }

  /** All non-compromised addresses across all chains (sweep-path use). */
  async findAllActive(): Promise<DepositAddress[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.user_id IS NOT NULL')
      .andWhere('a.status != :compromised', {
        compromised: DepositAddressStatus.COMPROMISED,
      })
      .getMany();
  }

  async listRecent(limit = 200): Promise<DepositAddress[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}

