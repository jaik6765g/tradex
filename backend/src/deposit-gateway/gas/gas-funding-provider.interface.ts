export const GAS_FUNDING_PROVIDER = 'GAS_FUNDING_PROVIDER';

export interface GasFundingProvider {
  readonly name: string;

  /**
   * Optionally fund the deposit address with native gas so a sweep can proceed.
   * Implementations MUST NOT auto-fund in production unless an explicit,
   * configured gas-funding policy/provider is in place.
   */
  fundIfNeeded(input: {
    chainId: number;
    address: string;
    requiredWei: bigint;
  }): Promise<{ funded: boolean }>;
}
