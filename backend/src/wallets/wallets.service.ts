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

  async findByAddress(address: string) {
    return this.walletsRepository.findOne({
      where: { address },
    });
  }

  async findByAddressAndChainId(address: string, chainId: number) {
    return this.walletsRepository.findOne({
      where: { address, chainId },
    });
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
