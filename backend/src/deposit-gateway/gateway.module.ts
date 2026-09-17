import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

import { Deposit } from '../deposits/deposit.entity';
import { User } from '../users/user.entity';
import { DepositModule } from '../deposits/deposit.module';
import { BlockchainModule } from '../blockchain/blockchain.module';

import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { DepositOrder } from './orders/deposit-order.entity';
import { DepositAddress } from './addresses/deposit-address.entity';
import { GatewayWatcherState } from './watchers/gateway-watcher-state.entity';
import { DepositSweep } from './sweeps/deposit-sweep.entity';

import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { DepositOrderService } from './orders/deposit-order.service';
import { DepositAddressService } from './addresses/deposit-address.service';
import { TokenRegistryService } from './tokens/token-registry.service';
import { NetworkRegistryService } from './networks/network-registry.service';
import { ChainRegistryService } from './chains/chain-registry.service';
import { OrderRateLimiterService } from './rate-limit/order-rate-limiter.service';

import { EvmDepositAdapter } from './chains/evm/evm-deposit-adapter';
import { EvmProductionPreflightService } from './chains/evm/evm-production-preflight.service';
import { EvmBalanceReconciliationService } from './chains/evm/evm-balance-reconciliation.service';
import { CustodyEmergencyService } from './custody/custody-emergency.service';
import { CustodyAuditLog } from './custody/custody-audit-log.entity';
import { CHAIN_ADAPTERS } from './chains/chain-adapter.interface';

import { DevDepositAddressProvider } from './addresses/dev-deposit-address-provider';
import { SelfCustodyHdWalletProvider } from './addresses/self-custody-hd-wallet.provider';
import { TronDepositAddressProvider } from './chains/tron/tron-address-provider';
import { SolanaDepositAddressProvider } from './chains/solana/solana-address-provider';
import { NoopDepositTransactionSigner } from './addresses/noop-deposit-transaction-signer';
import { DEPOSIT_ADDRESS_PROVIDER } from './addresses/deposit-address-provider.interface';
import { DEPOSIT_TRANSACTION_SIGNER } from './addresses/deposit-transaction-signer.interface';
import {
  depositProviderFactory,
  depositSignerFactory,
} from './addresses/deposit-provider.factory';

import { GAS_FUNDING_PROVIDER } from './gas/gas-funding-provider.interface';
import { NoopGasFundingProvider } from './gas/noop-gas-funding.provider';

import { GatewayDepositDetectionProcessor } from './processors/gateway-deposit-detection.processor';
import {
  TronDepositDetectionProcessor,
  TRON_DETECTION_QUEUE,
} from './processors/tron-deposit-detection.processor';
import { TronWatcherService } from './chains/tron/tron-watcher.service';
import { TronCustodySigner } from './chains/tron/tron-custody-signer';
import { TronDepositSweepService } from './chains/tron/tron-sweep.service';
import { TronReconciliationService } from './chains/tron/tron-reconciliation.service';
import { TronProductionPreflightService } from './chains/tron/tron-production-preflight.service';
import { SolanaWatcherService } from './chains/solana/solana-watcher.service';
import { SolanaDepositDetectionProcessor, SOLANA_DETECTION_QUEUE } from './chains/solana/solana-deposit-detection.processor';
import { SolanaCustodySigner } from './chains/solana/solana-custody-signer';
import { SolanaDepositSweepService } from './chains/solana/solana-sweep.service';
import { SolanaReconciliationService } from './chains/solana/solana-reconciliation.service';
import { SolanaProductionPreflightService } from './chains/solana/solana-production-preflight.service';
import { DepositWatcherService } from './watchers/deposit-watcher.service';
import { DepositReconciliationService } from './reconciliation/deposit-reconciliation.service';
import { DepositSweepService } from './sweeps/deposit-sweep.service';
import { DepositSweepProcessor } from './sweeps/deposit-sweep.processor';
import { DepositSweepConfirmationProcessor } from './sweeps/deposit-sweep-confirmation.processor';
import { BscGasBatch } from './admin-bsc-gas/entities/bsc-gas-batch.entity';
import { BscGasTransfer } from './admin-bsc-gas/entities/bsc-gas-transfer.entity';
import { BscGasStatusService } from './admin-bsc-gas/bsc-gas-status.service';
import { BscGasBatchService } from './admin-bsc-gas/bsc-gas-batch.service';
import { BscGasWalletService } from './admin-bsc-gas/bsc-gas-wallet.service';
import { AdminBscGasController } from './admin-bsc-gas/admin-bsc-gas.controller';
import { AdminAuthModule } from '../auth/admin-auth.module';

@Module({
  imports: [
    AdminAuthModule,
    TypeOrmModule.forFeature([
      Deposit,
      User,
      DepositOrder,
      DepositAddress,
      GatewayWatcherState,
      DepositSweep,
      CustodyAuditLog,
      AdminAuditLog,
      BscGasBatch,
      BscGasTransfer,
    ]),
    BullModule.registerQueue({ name: 'gateway-deposit-detection' }),
    BullModule.registerQueue({ name: TRON_DETECTION_QUEUE }),
    BullModule.registerQueue({ name: SOLANA_DETECTION_QUEUE }),
    BullModule.registerQueue({ name: 'deposit-confirmation' }),
    BullModule.registerQueue({ name: 'deposit-sweep' }),
    BullModule.registerQueue({ name: 'deposit-sweep-confirmation' }),
    BlockchainModule,
    DepositModule,
  ],
  controllers: [GatewayController, AdminBscGasController],
  providers: [
    GatewayService,
    DepositOrderService,
    DepositAddressService,
    TokenRegistryService,
    NetworkRegistryService,
    ChainRegistryService,
    OrderRateLimiterService,
    DevDepositAddressProvider,
    SelfCustodyHdWalletProvider,
    TronDepositAddressProvider,
    SolanaDepositAddressProvider,
    NoopDepositTransactionSigner,
    NoopGasFundingProvider,
    BscGasStatusService,
    BscGasBatchService,
    BscGasWalletService,
    GatewayDepositDetectionProcessor,
    TronDepositDetectionProcessor,
    TronWatcherService,
    DepositWatcherService,
    DepositReconciliationService,
    DepositSweepService,
    DepositSweepProcessor,
    DepositSweepConfirmationProcessor,
    EvmProductionPreflightService,
    EvmBalanceReconciliationService,
    CustodyEmergencyService,
    TronCustodySigner,
    TronDepositSweepService,
    TronReconciliationService,
    TronProductionPreflightService,
    SolanaWatcherService,
    SolanaDepositDetectionProcessor,
    SolanaCustodySigner,
    SolanaDepositSweepService,
    SolanaReconciliationService,
    SolanaProductionPreflightService,
    {
      provide: CHAIN_ADAPTERS,
      useFactory: (networks: NetworkRegistryService) =>
        networks.listWatchable().map((n) => new EvmDepositAdapter(n)),
      inject: [NetworkRegistryService],
    },
    {
      provide: DEPOSIT_ADDRESS_PROVIDER,
      useFactory: depositProviderFactory,
      inject: [
        ConfigService,
        DevDepositAddressProvider,
        SelfCustodyHdWalletProvider,
        TronDepositAddressProvider,
        SolanaDepositAddressProvider,
      ],
    },
    {
      provide: DEPOSIT_TRANSACTION_SIGNER,
      useFactory: depositSignerFactory,
      inject: [ConfigService, SelfCustodyHdWalletProvider, NoopDepositTransactionSigner],
    },
    {
      provide: GAS_FUNDING_PROVIDER,
      useClass: NoopGasFundingProvider,
    },
  ],
  exports: [GatewayService],
})
export class DepositGatewayModule {}

