// ============================================================
// DEPOSIT ADDRESS PROVIDER
// ============================================================
//
// Abstraction for generating TradeX-owned deposit addresses.
//
// SECURITY / CUSTODY RULES
// ------------------------------------------------------------
// - Never store plaintext private keys, seeds or mnemonics in Postgres.
// - Never expose private keys, seeds, mnemonics or custody secrets.
// - The provider resolves a deterministic derivation index (allocated by the
//   DepositAddressService under a transaction/lock) to an address; only the
//   index + path (never the secret material) are persisted.
// ============================================================

export interface GeneratedDepositAddress {
  address: string;
  chainId: number;
  provider: string;
  derivationIndex: number | null;
  derivationPath: string | null;
  metadata: Record<string, unknown>;
}

export interface GenerateAddressInput {
  chainId: number;
  /** Monotonic derivation index (allocated by DepositAddressService). */
  derivationIndex: number;
}

export const DEPOSIT_ADDRESS_PROVIDER = 'DEPOSIT_ADDRESS_PROVIDER';

export interface DepositAddressProvider {
  readonly name: string;

  generateAddress(
    input: GenerateAddressInput,
  ): GeneratedDepositAddress | Promise<GeneratedDepositAddress>;

  validateAddress(address: string, chainId: number): boolean;

  getAddressMetadata(address: string, chainId: number): Record<string, unknown>;

  /** True only for non-custodial dev providers (never safe for real funds). */
  isDevelopment(): boolean;
}

