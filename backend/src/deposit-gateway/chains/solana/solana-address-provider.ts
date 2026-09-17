import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type DepositAddressProvider,
  type GeneratedDepositAddress,
  type GenerateAddressInput,
} from '../../addresses/deposit-address-provider.interface';
import {
  DEFAULT_TEST_MNEMONIC,
} from '../tron/tron-production-preflight';
import {
  deriveSolanaAddress,
  isValidSolanaAddress,
  solanaPathForIndex,
} from './solana-address';

/**
 * Solana self-custody HD address provider: Ed25519 / SLIP-0010 / BIP44 coin 501
 * at m/44'/501'/0'/0'/<index>'. Produces base58 Ed25519 public addresses.
 *
 * SECURITY:
 * - Private key is derived transiently in memory from the configured mnemonic
 *   and is NEVER persisted, logged or returned.
 * - The public test mnemonic is rejected in production.
 */
@Injectable()
export class SolanaDepositAddressProvider implements DepositAddressProvider {
  readonly name = 'self_custody_solana';

  private readonly mnemonic: string | null;

  constructor(configService: ConfigService) {
    this.mnemonic =
      configService.get<string>('SOLANA_DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      configService.get<string>('DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      null;

    const env = (configService.get<string>('NODE_ENV') ?? 'development')
      .trim()
      .toLowerCase();
    if (
      env === 'production' &&
      this.mnemonic &&
      this.mnemonic.trim() === DEFAULT_TEST_MNEMONIC
    ) {
      throw new Error(
        'production must not use the public test mnemonic; configure a secure SOLANA_DEPOSIT_WALLET_MNEMONIC',
      );
    }
  }

  isDevelopment(): boolean {
    return false;
  }

  isConfigured(): boolean {
    return Boolean(this.mnemonic);
  }

  isDefaultTestMnemonic(): boolean {
    return Boolean(this.mnemonic && this.mnemonic.trim() === DEFAULT_TEST_MNEMONIC);
  }

  generateAddress(input: GenerateAddressInput): GeneratedDepositAddress {
    if (!this.mnemonic) {
      throw new Error(
        'SOLANA_DEPOSIT_WALLET_MNEMONIC (or DEPOSIT_WALLET_MNEMONIC) is not configured',
      );
    }
    if (!Number.isInteger(input.derivationIndex) || input.derivationIndex < 0) {
      throw new Error('Invalid Solana derivation index');
    }
    return {
      address: deriveSolanaAddress(this.mnemonic, input.derivationIndex),
      chainId: input.chainId,
      provider: this.name,
      derivationIndex: input.derivationIndex,
      derivationPath: solanaPathForIndex(input.derivationIndex),
      metadata: { custody: 'self', protocol: 'SOLANA' },
    };
  }

  validateAddress(address: string, _chainId: number): boolean {
    return isValidSolanaAddress(address);
  }

  getAddressMetadata(address: string, chainId: number): Record<string, unknown> {
    return { address, chainId, provider: this.name, custody: 'self', protocol: 'SOLANA' };
  }
}