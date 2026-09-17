import { ProtocolDepositAddressProvider } from './protocol-deposit-address-provider';
import { SelfCustodyHdWalletProvider } from './self-custody-hd-wallet.provider';
import { TronDepositAddressProvider } from '../chains/tron/tron-address-provider';
import { SolanaDepositAddressProvider } from '../chains/solana/solana-address-provider';
import { SOLANA_CHAIN_ID, TRON_CHAIN_ID } from '../config/networks.config';
import type { ConfigService } from '@nestjs/config';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('ProtocolDepositAddressProvider', () => {
  const evm = new SelfCustodyHdWalletProvider(
    config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
  );
  const tron = new TronDepositAddressProvider(
    config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
  );
  const solana = new SolanaDepositAddressProvider(
    config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
  );
  const provider = new ProtocolDepositAddressProvider(evm, tron, solana);

  it('routes EVM chain ids to 0x addresses', async () => {
    const r = await provider.generateAddress({ chainId: 56, derivationIndex: 0 });
    expect(r.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(r.provider).toBe('self_custody');
  });

  it('routes TRON chain id to a real Base58Check address', async () => {
    const r = await provider.generateAddress({
      chainId: TRON_CHAIN_ID,
      derivationIndex: 0,
    });
    expect(r.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    expect(r.provider).toBe('self_custody');
  });

  it('routes Solana chain id to a base58 Ed25519 address', async () => {
    const r = await provider.generateAddress({
      chainId: SOLANA_CHAIN_ID,
      derivationIndex: 0,
    });
    expect(r.address).toBe('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY');
    expect(r.provider).toBe('self_custody');
  });

  it('keeps same index addresses distinct across EVM / TRON / Solana', async () => {
    const evmA = await provider.generateAddress({ chainId: 56, derivationIndex: 0 });
    const tronA = await provider.generateAddress({ chainId: TRON_CHAIN_ID, derivationIndex: 0 });
    const solA = await provider.generateAddress({ chainId: SOLANA_CHAIN_ID, derivationIndex: 0 });
    const all = [evmA.address, tronA.address, solA.address];
    expect(new Set(all).size).toBe(3);
  });

  it('validates addresses against the matching protocol', () => {
    expect(
      provider.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 56),
    ).toBe(true);
    expect(
      provider.validateAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', TRON_CHAIN_ID),
    ).toBe(true);
    expect(
      provider.validateAddress('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY', SOLANA_CHAIN_ID),
    ).toBe(true);
    // Cross-protocol rejection: a Solana address is not valid on EVM/TRON.
    expect(
      provider.validateAddress('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY', 56),
    ).toBe(false);
    expect(
      provider.validateAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', SOLANA_CHAIN_ID),
    ).toBe(false);
  });
});
