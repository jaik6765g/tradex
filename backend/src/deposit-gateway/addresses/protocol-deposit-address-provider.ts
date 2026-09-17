import { TRON_CHAIN_ID, SOLANA_CHAIN_ID } from '../config/networks.config';
import {
  type DepositAddressProvider,
  type GeneratedDepositAddress,
  type GenerateAddressInput,
} from './deposit-address-provider.interface';

/**
 * Routes address generation/validation by network id while keeping EVM, TRON
 * and Solana derivation logic fully isolated:
 *   chainId === 195 (TRON)            -> TRON provider (Base58 Check)
 *   chainId === 501 (Solana)          -> Solana provider (base58 Ed25519)
 *   anything else                     -> EVM provider (0x)
 *
 * A single stable `name` is used for the derivation counter + persisted
 * `provider` column so the global uniqueness guarantees (USER + NETWORK unique,
 * cross-network index safety) hold unchanged.
 */
export class ProtocolDepositAddressProvider implements DepositAddressProvider {
  readonly name = 'self_custody';

  constructor(
    private readonly evm: DepositAddressProvider,
    private readonly tron: DepositAddressProvider,
    private readonly solana: DepositAddressProvider,
  ) {}

  isDevelopment(): boolean {
    return this.evm.isDevelopment();
  }

  async generateAddress(
    input: GenerateAddressInput,
  ): Promise<GeneratedDepositAddress> {
    const result = await this.route(input.chainId).generateAddress(input);
    return { ...result, provider: this.name };
  }

  validateAddress(address: string, chainId: number): boolean {
    return this.route(chainId).validateAddress(address, chainId);
  }

  getAddressMetadata(address: string, chainId: number): Record<string, unknown> {
    return this.route(chainId).getAddressMetadata(address, chainId);
  }

  private route(chainId: number): DepositAddressProvider {
    if (chainId === TRON_CHAIN_ID) return this.tron;
    if (chainId === SOLANA_CHAIN_ID) return this.solana;
    return this.evm;
  }
}
