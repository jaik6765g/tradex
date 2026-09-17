import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NetworkRegistryService } from '../../networks/network-registry.service';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { SolanaCustodySigner } from './solana-custody-signer';
import {
  runSolanaProductionPreflight,
  type SolanaReadinessReport,
} from './solana-production-preflight';

@Injectable()
export class SolanaProductionPreflightService {
  constructor(
    private readonly networkRegistry: NetworkRegistryService,
    private readonly addressService: DepositAddressService,
    private readonly configService: ConfigService,
    private readonly signer: SolanaCustodySigner,
  ) {}

  async evaluate(): Promise<SolanaReadinessReport> {
    const network = this.networkRegistry.getNetwork('solana');
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') ?? 'development';

    const addresses = await this.addressService.findActiveByChain(
      network.chainId as number,
    );

    // Determine secret source for the preflight report.
    const mnemonicConfigured = this.signer.isConfigured();
    const secretManagerConfigured =
      (this.configService.get<string>('SECRET_MANAGER_URL')?.trim() || '') !== '' ||
      (this.configService.get<string>('SOLANA_SECRET_PROVIDER')?.trim() || '') !== '';
    let secretSource: 'env' | 'secret-manager' | 'none' = 'none';
    if (secretManagerConfigured) {
      secretSource = 'secret-manager';
    } else if (mnemonicConfigured) {
      secretSource = 'env';
    }

    return runSolanaProductionPreflight({
      nodeEnv,
      network,
      treasury:
        network.treasuryAddress ||
        this.configService.get<string>('SOLANA_TREASURY_ADDRESS') ||
        this.configService.get<string>('DEPOSIT_TREASURY_ADDRESS') ||
        '',
      depositAddresses: addresses.map((a) => a.address),
      custodyAvailable: this.signer.canSign(),
      isDefaultTestMnemonic: this.signer.isDefaultTestMnemonic(),
      sweepGasLamports:
        this.configService.get<string>('SOLANA_SWEEP_GAS_LAMPORTS') ?? '',
      nonceConfigured:
        (this.configService.get<string>('SOLANA_NONCE_ACCOUNT')?.trim() || '') !== '',
      e2eEnabled:
        this.configService.get<string>('SOLANA_E2E_ENABLED') === 'true',
      secretSource,
    });
  }
}
