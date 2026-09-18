import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, In, Repository } from 'typeorm';
import Decimal from 'decimal.js';

import { DepositOrder, DepositOrderStatus } from './deposit-order.entity';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { TokenRegistryService } from '../tokens/token-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import { LimitsService } from '../../limits/limits.service';

export interface CreateOrderInput {
  userId: string;
  chainId: number;
  asset: string;
  amount: string;
}

const NON_TERMINAL_STATUSES: string[] = [
  DepositOrderStatus.CREATED,
  DepositOrderStatus.AWAITING_PAYMENT,
  DepositOrderStatus.DETECTED,
  DepositOrderStatus.CONFIRMING,
  DepositOrderStatus.CONFIRMED,
];

/**
 * Orders in these statuses can auto-expire via reconciliation.
 * NOTE: UNDERPAID user ke action ke bina terminal nahi hota tha — isliye
 * user hamesha ke liye atak jata tha. Ab UNDERPAID bhi expiry par EXPIRED
 * hoga taaki user naya order bana sake. Funds ka review alag se hota hai.
 */
const EXPIREABLE_STATUSES: string[] = [...NON_TERMINAL_STATUSES, DepositOrderStatus.UNDERPAID];

/**
 * Single-pending-order rule: while the user has a live (non-terminal /
 * non-expired) deposit order, a new order is rejected with 409 carrying the
 * active order id so the client can open it directly. Once the order reaches
 * a terminal state (COMPLETED / EXPIRED / FAILED / CANCELLED) or its expiry
 * passes, a fresh order may be created.
 */
const PENDING_ORDER_BLOCKLIST: string[] = [
  DepositOrderStatus.CREATED,
  DepositOrderStatus.AWAITING_PAYMENT,
  DepositOrderStatus.DETECTED,
  DepositOrderStatus.CONFIRMING,
  DepositOrderStatus.CONFIRMED,
  DepositOrderStatus.UNDERPAID,
];

@Injectable()
export class DepositOrderService {
  constructor(
    @InjectRepository(DepositOrder)
    private readonly orderRepo: Repository<DepositOrder>,
    private readonly addressService: DepositAddressService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly limitsService: LimitsService,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<DepositOrder> {
    const asset = (input.asset ?? '').toUpperCase();
    // Validates asset + network + USDT configured (throws if unsupported).
    const token = this.tokenRegistry.getToken(asset, input.chainId);

    // Explicitly block new orders on disabled / maintenance networks.
    const network = this.networkRegistry.getNetworkByChainId(input.chainId);
    if (!network || !network.depositEnabled) {
      throw new BadRequestException(
        `Network ${network?.id ?? input.chainId} is not enabled for deposits`,
      );
    }

    const amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('Invalid amount');
    }

    // Deposit min/max limits (10 / 10,000 USDT defaults) — backend is the
    // single source of truth; limits are read fresh from admin_settings on
    // every call (no cache). Rejects with machine-readable codes
    // DEPOSIT_BELOW_MINIMUM / DEPOSIT_ABOVE_MAXIMUM before ANY row is
    // written (no order, no address allocation, no balance/ledger touch).
    await this.limitsService.assertDepositAmount(amount);

    const expectedTdx = amount.mul(token.tdxRate);
    const expiryMinutes = Number(
      this.configService.get<string>('DEPOSIT_ORDER_EXPIRY_MINUTES') ?? '30',
    );
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(DepositOrder);

      // Single-pending-order guard (global, any chain): resume the live order instead of minting a new one.
      const pending = await orderRepo.findOne({
        where: {
          userId: input.userId,
          status: In(PENDING_ORDER_BLOCKLIST),
        },
        order: { createdAt: 'DESC' },
      });
      if (pending && new Date(pending.expiresAt).getTime() > Date.now()) {
        throw new ConflictException({
          message:
            'You already have a pending deposit order. Please complete or wait for it to expire before creating a new one.',
          activeOrderId: pending.id,
        });
      }

      const order = orderRepo.create({
        userId: input.userId,
        chainId: input.chainId,
        assetSymbol: asset,
        tokenAddress: token.contract,
        amount: amount.toFixed(18),
        expectedTdx: expectedTdx.toFixed(18),
        status: DepositOrderStatus.CREATED,
        expiresAt,
      });
      await orderRepo.save(order);

      // Allocate a unique deposit address (derivation-index based, custody-safe).
      const addressEntity = await this.addressService.allocateWithManager(
        manager,
        {
          chainId: input.chainId,
          userId: input.userId,
          orderId: order.id,
        },
      );

      order.depositAddressId = addressEntity.id;
      order.status = DepositOrderStatus.AWAITING_PAYMENT;
      await orderRepo.save(order);

      return order;
    });
  }

  async getById(orderId: string): Promise<DepositOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Deposit order not found');
    }
    return order;
  }

  /** Ownership-scoped lookup for authenticated users. */
  async getForUser(userId: string, orderId: string): Promise<DepositOrder> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, userId },
    });
    if (!order) {
      throw new NotFoundException('Deposit order not found');
    }
    return order;
  }

  async listForUser(userId: string): Promise<DepositOrder[]> {
    return this.orderRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async listAll(): Promise<DepositOrder[]> {
    return this.orderRepo.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  async updateStatus(orderId: string, status: string): Promise<void> {
    await this.orderRepo.update({ id: orderId }, { status });
  }

  async getByAddress(address: string, chainId: number) {
    const addr = await this.addressService.findByAddressAndChainId(
      address,
      chainId,
    );
    if (!addr?.orderId) {
      return null;
    }
    return this.orderRepo.findOne({ where: { id: addr.orderId } });
  }

  async listExpireable(now: Date): Promise<DepositOrder[]> {
    return this.orderRepo
      .createQueryBuilder('o')
      .where('o.status IN (:...statuses)', { statuses: EXPIREABLE_STATUSES })
      .andWhere('o.expires_at < :now', { now })
      .getMany();
  }

  /**
   * User ka live pending order — deposit form ke neeche dikhane ke liye.
   * Sirf non-expired live order return hota hai, taaki user ko naya order
   * banane ki zaroorat na pade: ya to usi order ko pura kare ya expire
   * hone ka wait kare. Expired/terminal par null taaki naya order bane.
   */
  async getActiveOrder(userId: string): Promise<DepositOrder | null> {
    const live = await this.orderRepo.findOne({
      where: {
        userId,
        status: In(PENDING_ORDER_BLOCKLIST),
      },
      order: { createdAt: 'DESC' },
    });
    if (!live) return null;
    if (new Date(live.expiresAt).getTime() <= Date.now()) return null;
    return live;
  }

  async listNonTerminal(): Promise<DepositOrder[]> {
    return this.orderRepo
      .createQueryBuilder('o')
      .where('o.status IN (:...statuses)', { statuses: NON_TERMINAL_STATUSES })
      .getMany();
  }
}
