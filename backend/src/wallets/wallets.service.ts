import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Wallet } from './wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
  ) {}

  /**
   * Case-insensitive, whitespace-tolerant address lookup.
   *
   * Linked wallets are stored in the EIP-55 CHECKSUMMED form (the auth flow
   * normalizes with getAddress() before persisting), while callers regularly
   * supply a lowercase or padded copy (pasted from an exchange, a wallet UI,
   * a QR scan). A bare string compare silently missed those rows and made an
   * ALREADY-LINKED wallet look unlinked. The exact match is attempted first
   * because it can use the address index; LOWER() is only the fallback.
   */
  async findByAddress(address: string) {
    const normalized = this.normalizeAddressInput(address);
    if (!normalized) {
      return null;
    }

    const exact = await this.walletsRepository.findOne({
      where: { address: normalized },
    });

    if (exact) {
      return exact;
    }

    return this.walletsRepository
      .createQueryBuilder('wallet')
      .where('LOWER(wallet.address) = LOWER(:address)', { address: normalized })
      .getOne();
  }

  /**
   * Same contract as findByAddress(), scoped to one chain.
   *
   * Normalizing the LOOKUP never weakens ownership: the caller still compares
   * the returned row's userId against the authenticated user, so a case
   * difference can only ever turn a false "not found" into the correct row
   * (or into the correct 403 when the row belongs to someone else).
   */
  async findByAddressAndChainId(address: string, chainId: number) {
    const normalized = this.normalizeAddressInput(address);
    if (!normalized || !Number.isInteger(chainId)) {
      return null;
    }

    const exact = await this.walletsRepository.findOne({
      where: { address: normalized, chainId },
    });

    if (exact) {
      return exact;
    }

    return this.walletsRepository
      .createQueryBuilder('wallet')
      .where('LOWER(wallet.address) = LOWER(:address)', { address: normalized })
      .andWhere('wallet.chainId = :chainId', { chainId })
      .getOne();
  }

  /**
   * Every wallet linked to the user, newest first.
   *
   * The withdrawal screen uses this to gate the form on the wallets the
   * backend will actually accept as a payout destination.
   */
  async listByUser(userId: string) {
    if (!userId) {
      return [];
    }

    return this.walletsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  private normalizeAddressInput(address: unknown): string {
    return typeof address === 'string' ? address.trim() : '';
  }

  async create(userId: string, address: string, chainId: number) {
    const wallet = this.walletsRepository.create({
      userId,
      address,
      chainId,
      isPrimary: true,
    });

    return this.walletsRepository.save(wallet);
  }

  async findOrCreate(userId: string, address: string, chainId: number) {
    const existing = await this.findByAddressAndChainId(address, chainId);

    if (existing) {
      return existing;
    }

    return this.create(userId, address, chainId);
  }
}
