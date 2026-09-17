import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DepositAddressService } from '../../addresses/deposit-address.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import { TronCustodySigner } from './tron-custody-signer';
import {
  runTronProductionPreflight,
  type TronReadinessReport,
} from './tron-production-preflight';

@Injectable()
export class TronProductionPreflightService {
  constructor(
    private readonly configService: ConfigService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly addressService: DepositAddressService,
    private readonly signer: TronCustodySigner,
  ) {}

  async evaluate(): Promise<TronReadinessReport> {
    const network = this.networkRegistry.getNetwork('tron');
    const addresses = await this.addressService.findActiveByChain(TRON_CHAIN_ID);

    return runTronProductionPreflight({
      nodeEnv: this.configService.get<string>('NODE_ENV') ?? 'development',
      network,
      apiKey: this.configService.get<string>('TRON_GRID_API_KEY')?.trim() || undefined,
      treasury: network.treasuryAddress,
      depositAddresses: addresses.map((a) => a.address),
      custodyAvailable: this.signer.canSign(),
      isDefaultTestMnemonic: this.signer.isDefaultTestMnemonic(),
      sweepGasTrx: this.configService.get<string>('TRON_SWEEP_GAS_TRX') ?? '',
      sweepEnabledGlobal:
        this.configService.get<string>('DEPOSIT_SWEEP_ENABLED') === 'true',
    });
  }
}