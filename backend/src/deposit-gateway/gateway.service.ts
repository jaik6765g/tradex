import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { Deposit, DepositStatus } from '../deposits/deposit.entity';
import { DepositAddressService } from './addresses/deposit-address.service';
import { DepositOrderService } from './orders/deposit-order.service';
import { OrderRateLimiterService } from './rate-limit/order-rate-limiter.service';
import { TokenRegistryService } from './tokens/token-registry.service';
import { NetworkRegistryService } from './networks/network-registry.service';
import { ChainRegistryService } from './chains/chain-registry.service';
import { DepositOrder } from './orders/deposit-order.entity';
import { DepositSweepService } from './sweeps/deposit-sweep.service';
import { TronReconciliationService } from './chains/tron/tron-reconciliation.service';
import { TronProductionPreflightService } from './chains/tron/tron-production-preflight.service';
import { TronWatcherService } from './chains/tron/tron-watcher.service';
import { SolanaWatcherService } from './chains/solana/solana-watcher.service';
import { SolanaReconciliationService } from './chains/solana/solana-reconciliation.service';
import { SolanaProductionPreflightService } from './chains/solana/solana-production-preflight.service';
import { DepositWatcherService } from './watchers/deposit-watcher.service';
import { EvmProductionPreflightService } from './chains/evm/evm-production-preflight.service';
import { EvmBalanceReconciliationService } from './chains/evm/evm-balance-reconciliation.service';
import { CustodyEmergencyService } from './custody/custody-emergency.service';
import {
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
} from './config/networks.config';

@Injectable()
export class GatewayService implements OnModuleInit {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly orderService: DepositOrderService,
    private readonly addressService: DepositAddressService,
    private readonly rateLimiter: OrderRateLimiterService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly sweepService: DepositSweepService,
    private readonly tronReconciliation: TronReconciliationService,
    private readonly tronPreflight: TronProductionPreflightService,
    private readonly tronWatcher: TronWatcherService,
    private readonly solanaWatcher: SolanaWatcherService,
    private readonly solanaReconciliation: SolanaReconciliationService,
    private readonly solanaPreflight: SolanaProductionPreflightService,
    private readonly depositWatcher: DepositWatcherService,
    private readonly evmPreflight: EvmProductionPreflightService,
    private readonly evmBalanceReconciliation: EvmBalanceReconciliationService,
    private readonly custodyEmergency: CustodyEmergencyService,
    private readonly configService: ConfigService,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
  ) {}

  // Startup-only safe diagnostic (never prints secrets / mnemonics / keys).
  onModuleInit(): void {
    this.logger.log(
      'Deposit Gateway: ' +
        `provider=${this.addressService.providerName()}, ` +
        `development=${this.addressService.isDevelopment()}, ` +
        `mode=${this.configService.get<string>('NODE_ENV', 'development')}, ` +
        `chains=[${this.chainRegistry.listChains().map((c) => c.chainId).join(',')}], ` +
        `sweepEnabled=${this.configService.get<string>('DEPOSIT_SWEEP_ENABLED') === 'true'}`,
    );
  }

  async createOrder(
    userId: string,
    dto: { chainId: number; asset: string; amount: string },
  ) {
    this.rateLimiter.assertAllowed(userId);

    const order = await this.orderService.createOrder({
      userId,
      chainId: dto.chainId,
      asset: dto.asset,
      amount: dto.amount,
    });

    return this.buildResponse(order);
  }

  async getOrder(userId: string, orderId: string) {
    const order = await this.orderService.getForUser(userId, orderId);
    return this.buildResponse(order);
  }

  async getOrderStatus(userId: string, orderId: string) {
    const order = await this.orderService.getForUser(userId, orderId);
    const deposit = await this.depositRepo.findOne({
      where: { orderId: order.id },
    });

    return {
      status: order.status,
      confirmations: deposit?.confirmations ?? 0,
      requiredConfirmations: deposit?.requiredConfirmations ?? null,
      credited: deposit?.status === DepositStatus.COMPLETED,
      transactionHash: deposit?.transactionHash ?? null,
    };
  }

  async listOrders(userId: string) {
    const orders = await this.orderService.listForUser(userId);
    return Promise.all(orders.map((o) => this.buildResponse(o)));
  }

  /**
   * Live pending order — deposit form ke neeche dikhane ke liye.
   * Response: `{ activeOrder: <order-slip> | null }`.
   * - Live order hai → frontend usi ko kholta hai, naya order block hota hai.
   * - Null hai → naya order ban sakta hai.
   */
  async getActiveOrder(userId: string) {
    const live = await this.orderService.getActiveOrder(userId);
    if (!live) {
      return { activeOrder: null };
    }
    return { activeOrder: await this.buildResponse(live) };
  }

  async adminListOrders() {
    const orders = await this.orderService.listAll();
    return Promise.all(orders.map((o) => this.buildResponse(o)));
  }

  getConfig() {
    return {
      mode: this.configService.get<string>('NODE_ENV', 'development'),
      provider: {
        name: this.addressService.providerName(),
        development: this.addressService.isDevelopment(),
      },
      sweepEnabled:
        this.configService.get<string>('DEPOSIT_SWEEP_ENABLED') === 'true',
      networks: this.networkRegistry.listNetworks(),
      chains: this.chainRegistry.listChains(),
      tdxRate: this.tokenRegistry.getTdxRate(),
      asset: 'USDT',
    };
  }

  async adminListAddresses() {
    const addresses = await this.addressService.listRecent();
    return addresses.map((a) => ({
      id: a.id,
      address: a.address,
      chainId: a.chainId,
      userId: a.userId,
      orderId: a.orderId,
      provider: a.provider,
      derivationIndex: a.derivationIndex,
      derivationPath: a.derivationPath,
      status: a.status,
      createdAt: a.createdAt,
    }));
  }

  async adminListSweeps() {
    const sweeps = await this.sweepService.listRecent();
    return sweeps.map((s) => ({
      id: s.id,
      depositId: s.depositId,
      depositAddressId: s.depositAddressId,
      chainId: s.chainId,
      assetSymbol: s.assetSymbol,
      tokenAddress: s.tokenAddress,
      amount: s.amount,
      destinationAddress: s.destinationAddress,
      status: s.status,
      sweepTxHash: s.sweepTxHash,
      failureReason: s.failureReason,
      submittedAt: s.submittedAt,
      confirmedAt: s.confirmedAt,
      createdAt: s.createdAt,
    }));
  }

  async adminListTronReconciliation() {
    const rows = await this.tronReconciliation.reconcile();
    return rows.map((r) => ({
      address: r.address,
      userId: r.userId,
      balanceSun: r.balanceSun,
      depositedSun: r.depositedSun,
      sweptSun: r.sweptSun,
      pendingSweepSun: r.pendingSweepSun,
      expectedRemainingSun: r.expectedRemainingSun,
      residualSun: r.residualSun,
      status: r.status,
    }));
  }

  /** Safe TRON production-readiness diagnostics (never exposes secrets). */
  async adminTronReadiness() {
    const report = await this.tronPreflight.evaluate();
    const network = this.networkRegistry.getNetwork('tron');
    return {
      ...report,
      e2eEnabled: this.configService.get<string>('TRON_E2E_ENABLED') === 'true',
      network: {
        id: network.id,
        chainId: network.chainId,
        configured: network.configured,
        usdtContract: network.usdtContract,
        confirmations: network.confirmations,
      },
      watcher: this.tronWatcher.status(),
      queueHealth: await this.tronWatcher.queueHealth(),
      solanaWatcher: this.solanaWatcher.status(),
      reconciliation: this.tronReconciliation.status(),
    };
  }

  async adminListSolanaReconciliation() {
    const rows = await this.solanaReconciliation.reconcile();
    return rows.map((r) => ({
      address: r.address,
      userId: r.userId,
      usdtBalanceRaw: r.usdtBalanceRaw,
      depositedRaw: r.depositedRaw,
      sweptRaw: r.sweptRaw,
      pendingSweepRaw: r.pendingSweepRaw,
      expectedRemainingRaw: r.expectedRemainingRaw,
      residualRaw: r.residualRaw,
      status: r.status,
      tokenAccount: r.tokenAccount,
    }));
  }

  async adminSolanaReadiness() {
    const report = await this.solanaPreflight.evaluate();
    const network = this.networkRegistry.getNetwork('solana');
    return {
      ...report,
      network: {
        id: network.id,
        chainId: network.chainId,
        configured: network.configured,
        usdtContract: network.usdtContract,
        confirmations: network.confirmations,
        status: network.status,
        depositEnabled: network.depositEnabled,
        watcherEnabled: network.watcherEnabled,
        sweepEnabled: network.sweepEnabled,
      },
      watcher: this.solanaWatcher.status(),
      queueHealth: await this.solanaWatcher.queueHealth(),
      reconciliation: this.solanaReconciliation.status(),
      e2eEnabled: this.configService.get<string>('SOLANA_E2E_ENABLED') === 'true',
    };
  }

  /**
   * Generic EVM network readiness (Phase 7.1) — one network evaluated at a
   * time so Polygon and Arbitrum are reported INDEPENDENTLY (one failing
   * never masks the other). Response is safe: no keys/secrets/RPC credentials.
   */
  async adminEvmReadiness(networkId: string, chainId: number) {
    const report = await this.evmPreflight.evaluate(networkId);
    const network = this.networkRegistry.getNetwork(networkId);
    const watcherChain = this.depositWatcher
      .status()
      .chains.find((c) => c.chainId === chainId);
    return {
      ...report,
      network: {
        id: network.id,
        protocol: network.protocol,
        chainId: network.chainId,
        configured: network.configured,
        usdtContract: network.usdtContract,
        usdtDecimals: network.usdtDecimals,
        confirmations: network.confirmations,
        status: network.status,
        depositEnabled: network.depositEnabled,
        watcherEnabled: network.watcherEnabled,
        sweepEnabled: network.sweepEnabled,
      },
      watcher: watcherChain ?? null,
      queueHealth: await this.depositWatcher.queueHealth(),
      balanceReconciliation: await this.evmBalanceReconciliation.reconcileChain(
        chainId,
      ),
    };
  }

  async adminPolygonReadiness() {
    return this.adminEvmReadiness('polygon', POLYGON_CHAIN_ID);
  }

  async adminArbitrumReadiness() {
    return this.adminEvmReadiness('arbitrum', ARBITRUM_CHAIN_ID);
  }

  /**
   * Safe custody status for admins. Returns ONLY operational metadata:
   * state, generation, whether allocation/sweep are allowed. NEVER returns
   * the master seed, private keys, or any secret material.
   */
  async adminCustodyStatus() {
    const status = this.custodyEmergency.getCustodyStatus();
    return {
      state: status.state,
      generation: status.generation,
      allocationAllowed: status.allocationAllowed,
      automaticSweepAllowed: status.automaticSweepAllowed,
    };
  }

  /** Safe custody audit-log listing (no secrets). */
  async adminCustodyAuditLogs() {
    const logs = await this.custodyEmergency.listAuditLogs(100);
    return logs.map((l) => ({
      id: l.id,
      actorId: l.actorId,
      action: l.action,
      network: l.network,
      address: l.address,
      depositAddressId: l.depositAddressId,
      custodyGeneration: l.custodyGeneration,
      reason: l.reason,
      result: l.result,
      correlationId: l.correlationId,
      metadata: l.metadata,
      createdAt: l.createdAt,
    }));
  }

  private async buildResponse(order: DepositOrder) {
    const address = order.depositAddressId
      ? await this.addressService.findById(order.depositAddressId)
      : null;
    const deposit = await this.depositRepo.findOne({
      where: { orderId: order.id },
    });

    return {
      id: order.id,
      chainId: order.chainId,
      asset: order.assetSymbol,
      tokenAddress: order.tokenAddress,
      amount: order.amount,
      tdxAmount: order.expectedTdx,
      depositAddress: address?.address ?? null,
      provider: address?.provider ?? this.addressService.providerName(),
      development: this.addressService.isDevelopment(),
      expiresAt: order.expiresAt,
      status: order.status,
      transactionHash: deposit?.transactionHash ?? null,
      confirmations: deposit?.confirmations ?? 0,
      requiredConfirmations: deposit?.requiredConfirmations ?? null,
      credited: deposit?.status === DepositStatus.COMPLETED,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
