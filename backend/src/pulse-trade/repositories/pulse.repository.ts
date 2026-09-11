import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Trade } from '../entities/trade.entity';
import { TradeSnapshot } from '../entities/trade-snapshot.entity';
import { TradeStatus } from '../constants/enums';

@Injectable()
export class PulseRepository {
  constructor(
    @InjectRepository(Trade)
    private readonly repository: Repository<Trade>,
    @InjectRepository(TradeSnapshot)
    private readonly snapshotRepository: Repository<TradeSnapshot>,
  ) {}

  async findById(id: string): Promise<Trade | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Trade[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(data: Partial<Trade>): Promise<Trade> {
    const trade = this.repository.create(data);
    return this.repository.save(trade);
  }

  async update(id: string, data: Partial<Trade>): Promise<Trade | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async updateStatus(id: string, status: TradeStatus): Promise<Trade | null> {
    await this.repository.update(id, { status });
    return this.findById(id);
  }

  async findActiveTrades(userId: string): Promise<Trade[]> {
    return this.repository.find({
      where: {
        userId,
        status: In([
          TradeStatus.ACCEPTED,
          TradeStatus.ENTRY_CLOSED,
          TradeStatus.EXPIRING,
          TradeStatus.SETTLING,
          TradeStatus.SETTLEMENT_DELAYED,
        ]),
      },
    });
  }

  async createSnapshot(tradeId: string, price: string): Promise<TradeSnapshot> {
    const trade = await this.findById(tradeId);
    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    const normalizedPrice = new Decimal(price);
    if (!normalizedPrice.isFinite() || normalizedPrice.lte(0)) {
      throw new BadRequestException('Snapshot price must be greater than zero');
    }

    const snapshot = this.snapshotRepository.create({
      tradeId,
      symbol: trade.pair,
      price: normalizedPrice.toFixed(18),
      timestamp: new Date(),
    });

    return this.snapshotRepository.save(snapshot);
  }
}
