import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NetworkRegistryService } from '../../networks/network-registry.service';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import {
  DEPOSIT_TRANSACTION_SIGNER,
  type DepositTransactionSigner,
} from '../../addresses/deposit-transaction-signer.interface';
import { NETWORK_DEFINITIONS } from '../../config/networks.config';
import {
  runEvmProductionPreflight,
  type EvmReadinessReport,
} from './evm-production-preflight';

/** Public test mnemonic — identical constant is rejected by TRON/Solana gates. */
const DEFAULT_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/**
 * Generic EVM production-readiness gate (Phase 7.1).
 *
 * Evaluates one network at a time (currently polygon + arbitrum) so one
 * network failing NEVER disables or masks the other. Canonical facts come
 * from NETWORK_DEFINITIONS (single source of truth). Never exposes secrets —
 * only booleans and the public contract address.
 */
@Injectable()
export class EvmProductionPreflightService {
  constructor(
    private readonly networkRegistry: NetworkRegistryService,
    private readonly addressService: DepositAddressService,
    private readonly configService: ConfigService,
    @Inject(DEPOSIT_TRANSACTION_SIGNER)
    private readonly signer: DepositTransactionSigner,
  ) {}

  async evaluate(networkId: string): Promise<EvmReadinessReport> {
    const definition = NETWORK_DEFINITIONS.find((d) => d.id === networkId);
    if (!definition || definition.protocol !== 'EVM') {
      throw new Error(`Unknown EVM network: ${networkId}`);
    }

    const network = this.networkRegistry.getNetwork(networkId);
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') ?? 'development';

    const addresses = await this.addressService.findActiveByChain(
      network.chainId as number,
    );

    // Secret-source classification (boolean-level only — no values).
    const mnemonic = this.configService.get<string>('DEPOSIT_WALLET_MNEMONIC')?.trim();
    const secretManagerConfigured =
      (this.configService.get<string>('SECRET_MANAGER_URL')?.trim() || '') !== '';
    const secretSource: 'env' | 'secret-manager' | 'none' =
      secretManagerConfigured
        ? 'secret-manager'
        : mnemonic
          ? 'env'
          : 'none';

    return runEvmProductionPreflight({
      nodeEnv,
      networkId,
      network,
      canonical: {
        chainId: definition.chainId as number,
        usdtContract: definition.usdtContract,
        usdtDecimals: definition.usdtDecimals,
        requiredConfirmations: definition.requiredConfirmations,
      },
      treasury:
        network.treasuryAddress ||
        this.configService.get<string>(`${networkId.toUpperCase()}_TREASURY_ADDRESS`) ||
        this.configService.get<string>('DEPOSIT_TREASURY_ADDRESS') ||
        '',
      depositAddresses: addresses.map((a) => a.address),
      custodyAvailable: this.signer.canSign(),
      isTestMnemonic: Boolean(mnemonic && mnemonic === DEFAULT_TEST_MNEMONIC),
      sweepGasLimit:
        this.configService.get<string>('GAS_SWEEP_GAS_LIMIT') ?? '',
      secretSource,
    });
  }
}