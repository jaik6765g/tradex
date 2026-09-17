import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';

import {
  type DepositAddressProvider,
  type GeneratedDepositAddress,
  type GenerateAddressInput,
} from './deposit-address-provider.interface';

/**
 * DEV-ONLY address provider.
 *
 * Generates a deterministic, checksummed EVM address from a fixed dev
 * namespace + chain + derivation index. It produces a structurally valid
 * address but NO private key is ever created or stored — this is purely for
 * local development so the end-to-end flow (address -> QR -> watcher -> match
 * -> credit) can run.
 *
 * DO NOT USE IN PRODUCTION. Production uses SelfCustodyHdWalletProvider or a
 * custody provider that owns the corresponding private keys safely.
 */
@Injectable()
export class DevDepositAddressProvider implements DepositAddressProvider {
  readonly name = 'dev';

  isDevelopment(): boolean {
    return true;
  }

  generateAddress(input: GenerateAddressInput): GeneratedDepositAddress {
    const digest = ethers.keccak256(
      ethers.toUtf8Bytes(
        `tradex-dev-deposit:v1:${input.chainId}:${input.derivationIndex}`,
      ),
    );

    const address = ethers.getAddress(`0x${digest.slice(-40)}`);

    return {
      address,
      chainId: input.chainId,
      provider: this.name,
      derivationIndex: input.derivationIndex,
      derivationPath: `dev/${input.chainId}/${input.derivationIndex}`,
      metadata: { dev: true },
    };
  }

  validateAddress(address: string, _chainId: number): boolean {
    try {
      ethers.getAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  getAddressMetadata(address: string, chainId: number): Record<string, unknown> {
    return { address, chainId, provider: this.name, dev: true };
  }
}

