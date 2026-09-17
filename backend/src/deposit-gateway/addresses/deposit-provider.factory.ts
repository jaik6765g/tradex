import { ConfigService } from '@nestjs/config';

import { type DepositAddressProvider } from './deposit-address-provider.interface';
import { type DepositTransactionSigner } from './deposit-transaction-signer.interface';
import { DevDepositAddressProvider } from './dev-deposit-address-provider';
import { SelfCustodyHdWalletProvider } from './self-custody-hd-wallet.provider';
import { TronDepositAddressProvider } from '../chains/tron/tron-address-provider';
import { SolanaDepositAddressProvider } from '../chains/solana/solana-address-provider';
import { ProtocolDepositAddressProvider } from './protocol-deposit-address-provider';
import { NoopDepositTransactionSigner } from './noop-deposit-transaction-signer';

export function resolveProviderKey(config: ConfigService): string {
  return (config.get<string>('DEPOSIT_ADDRESS_PROVIDER') ?? 'dev')
    .trim()
    .toLowerCase();
}

/**
 * Resolves the deposit address provider and enforces the production safety
 * gate:
 * - production + dev → throw (startup fails)
 * - self_custody without mnemonic → throw (no silent dev fallback)
 *
 * The returned provider routes by network id: EVM → EVM custody, TRON → TRON
 * custody (real Base58Check addresses).
 */
export function depositProviderFactory(
  config: ConfigService,
  dev: DevDepositAddressProvider,
  hd: SelfCustodyHdWalletProvider,
  tron: TronDepositAddressProvider,
  solana: SolanaDepositAddressProvider,
): DepositAddressProvider {
  const key = resolveProviderKey(config);
  const env = (config.get<string>('NODE_ENV') ?? 'development')
    .trim()
    .toLowerCase();

  if (env === 'production' && key === 'dev') {
    throw new Error(
      'DEPOSIT_ADDRESS_PROVIDER=dev is not allowed in production. Configure a real custody provider.',
    );
  }

  if (key === 'dev') {
    return new ProtocolDepositAddressProvider(dev, tron, solana);
  }

  if (key === 'self_custody') {
    if (!hd.isConfigured()) {
      throw new Error(
        'DEPOSIT_ADDRESS_PROVIDER=self_custody requires DEPOSIT_WALLET_MNEMONIC to be configured.',
      );
    }
    return new ProtocolDepositAddressProvider(hd, tron, solana);
  }

  throw new Error(`Unsupported DEPOSIT_ADDRESS_PROVIDER: ${key}`);
}

export function depositSignerFactory(
  config: ConfigService,
  hd: SelfCustodyHdWalletProvider,
  noop: NoopDepositTransactionSigner,
): DepositTransactionSigner {
  const key = resolveProviderKey(config);
  return key === 'self_custody' ? hd : noop;
}
