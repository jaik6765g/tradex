import { SolanaDepositAddressProvider } from './solana-address-provider';
import type { ConfigService } from '@nestjs/config';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('SolanaDepositAddressProvider', () => {
  it('derives deterministic base58 Ed25519 addresses', () => {
    const p = new SolanaDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 501, derivationIndex: 0 });
    expect(a0.address).toBe('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY');
    expect(a0.derivationPath).toBe("m/44'/501'/0'/0'/0'");
    expect(a0.provider).toBe('self_custody_solana');
    expect(a0.chainId).toBe(501);
  });

  it('produces different addresses per index and validates', () => {
    const p = new SolanaDepositAddressProvider(
      config({ SOLANA_DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 501, derivationIndex: 0 });
    const a1 = p.generateAddress({ chainId: 501, derivationIndex: 1 });
    expect(a0.address).not.toBe(a1.address);
    expect(p.validateAddress(a0.address, 501)).toBe(true);
    expect(p.isDevelopment()).toBe(false);
    expect(p.isConfigured()).toBe(true);
  });

  it('validates only Solana addresses (rejects EVM/TRON)', () => {
    const p = new SolanaDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(p.validateAddress('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY', 501)).toBe(true);
    expect(p.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 501)).toBe(false);
    expect(p.validateAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', 501)).toBe(false);
  });

  it('is unconfigured without a mnemonic', () => {
    const p = new SolanaDepositAddressProvider(config({}));
    expect(p.isConfigured()).toBe(false);
    expect(() => p.generateAddress({ chainId: 501, derivationIndex: 0 })).toThrow(
      /not configured/,
    );
  });

  it('rejects the public test mnemonic in production (no secret exposed)', () => {
    expect(() =>
      new SolanaDepositAddressProvider(
        config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC, NODE_ENV: 'production' }),
      ),
    ).toThrow(/must not use the public test mnemonic/);
  });

  it('never exposes the private key from generateAddress', () => {
    const p = new SolanaDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a = p.generateAddress({ chainId: 501, derivationIndex: 0 });
    const json = JSON.stringify(a);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('private');
    expect(json).not.toContain(MNEMONIC.slice(0, 10));
  });
});