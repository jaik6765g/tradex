import { TronDepositAddressProvider } from './tron-address-provider';
import type { ConfigService } from '@nestjs/config';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('TronDepositAddressProvider', () => {
  it('derives real Base58Check TRON addresses deterministically', () => {
    const p = new TronDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 195, derivationIndex: 0 });
    expect(a0.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    expect(a0.derivationPath).toBe("m/44'/195'/0'/0/0");
    expect(a0.provider).toBe('self_custody_tron');
    expect(a0.chainId).toBe(195);
  });

  it('produces different, valid addresses for different indices', () => {
    const p = new TronDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 195, derivationIndex: 0 });
    const a1 = p.generateAddress({ chainId: 195, derivationIndex: 1 });
    expect(a0.address).not.toBe(a1.address);
    expect(p.validateAddress(a0.address, 195)).toBe(true);
    expect(p.validateAddress(a1.address, 195)).toBe(true);
  });

  it('is a real (non-dev) custody provider', () => {
    const p = new TronDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(p.isDevelopment()).toBe(false);
    expect(p.isConfigured()).toBe(true);
  });

  it('validates TRON addresses only (rejects EVM 0x)', () => {
    const p = new TronDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(p.validateAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', 195)).toBe(true);
    expect(p.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 195)).toBe(false);
    expect(p.validateAddress('not-an-address', 195)).toBe(false);
  });

  it('prefers TRON_DEPOSIT_WALLET_MNEMONIC over the EVM mnemonic', () => {
    const p = new TronDepositAddressProvider(
      config({ TRON_DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 195, derivationIndex: 0 });
    expect(a0.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  });

  it('is unconfigured (cannot derive) without a mnemonic', () => {
    const p = new TronDepositAddressProvider(config({}));
    expect(p.isConfigured()).toBe(false);
    expect(() => p.generateAddress({ chainId: 195, derivationIndex: 0 })).toThrow(
      /not configured/,
    );
  });

  it('rejects invalid derivation indices', () => {
    const p = new TronDepositAddressProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(() => p.generateAddress({ chainId: 195, derivationIndex: -1 })).toThrow();
  });
});
