import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import {
  type DepositAddressProvider,
  type GeneratedDepositAddress,
  type GenerateAddressInput,
} from '../../addresses/deposit-address-provider.interface';
import {
  deriveTronAddressFromPrivateKey,
  isValidTronAddress,
  TRON_HD_PATH,
} from './tron-address';

/**
 * TRON self-custody HD address provider (BIP44 / coin type 195).
 *
 * - Derives child private keys from a mnemonic held in memory only (never in
 *   Postgres / logs / responses / source). Only the derivation index + path are
 *   persisted by the gateway.
 * - Produces REAL Base58Check TRON addresses (NOT EVM 0x addresses, NOT string
 *   hashes).
 */
@Injectable()
export class TronDepositAddressProvider implements DepositAddressProvider {
  readonly name = 'self_custody_tron';

  private readonly root: ethers.HDNodeWallet | null;

  constructor(configService: ConfigService) {
    const mnemonic =
      configService.get<string>('TRON_DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      configService.get<string>('DEPOSIT_WALLET_MNEMONIC')?.trim();

    this.root = mnemonic
      ? ethers.HDNodeWallet.fromMnemonic(
          ethers.Mnemonic.fromPhrase(mnemonic),
          TRON_HD_PATH,
        )
      : null;
  }

  isDevelopment(): boolean {
    return false;
  }

  isConfigured(): boolean {
    return this.root !== null;
  }

  generateAddress(input: GenerateAddressInput): GeneratedDepositAddress {
    const wallet = this.derive(input.derivationIndex);
    return {
      address: deriveTronAddressFromPrivateKey(wallet.privateKey),
      chainId: input.chainId,
      provider: this.name,
      derivationIndex: input.derivationIndex,
      derivationPath: `${TRON_HD_PATH}/${input.derivationIndex}`,
      metadata: { custody: 'self', protocol: 'TRON' },
    };
  }

  validateAddress(address: string, _chainId: number): boolean {
    return isValidTronAddress(address);
  }

  getAddressMetadata(address: string, chainId: number): Record<string, unknown> {
    return { address, chainId, provider: this.name, custody: 'self', protocol: 'TRON' };
  }

  private derive(index: number): ethers.HDNodeWallet {
    if (!this.root) {
      throw new Error(
        'TRON_DEPOSIT_WALLET_MNEMONIC (or DEPOSIT_WALLET_MNEMONIC) is not configured',
      );
    }
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Invalid derivation index');
    }
    return this.root.deriveChild(index);
  }
}
