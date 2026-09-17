import { SelfCustodyHdWalletProvider } from './self-custody-hd-wallet.provider';
import type { ConfigService } from '@nestjs/config';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('SelfCustodyHdWalletProvider', () => {
  it('derives deterministic BIP44 EVM addresses by index', () => {
    const p = new SelfCustodyHdWalletProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const a0 = p.generateAddress({ chainId: 56, derivationIndex: 0 });
    const a1 = p.generateAddress({ chainId: 1, derivationIndex: 1 });

    expect(a0.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    expect(a1.address).toBe('0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0');
    expect(a0.address).not.toBe(a1.address);
    expect(a0.derivationPath).toBe("m/44'/60'/0'/0/0");
    expect(a1.derivationPath).toBe("m/44'/60'/0'/0/1");
  });

  it('is deterministic for the same index regardless of chain', () => {
    const p = new SelfCustodyHdWalletProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const b56 = p.generateAddress({ chainId: 56, derivationIndex: 2 });
    const b1 = p.generateAddress({ chainId: 1, derivationIndex: 2 });
    // Same index → same address (chain does not affect derivation, so a single
    // global counter is what guarantees cross-network uniqueness).
    expect(b56.address).toBe(b1.address);
    expect(b56.address).toBe('0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A');
  });

  it('is not development and can sign only when a mnemonic is present', () => {
    const p = new SelfCustodyHdWalletProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(p.isDevelopment()).toBe(false);
    expect(p.canSign()).toBe(true);
    expect(p.isConfigured()).toBe(true);
  });

  it('is unconfigured (cannot sign) without a mnemonic', () => {
    const p = new SelfCustodyHdWalletProvider(config({}));
    expect(p.isConfigured()).toBe(false);
    expect(p.canSign()).toBe(false);
    expect(() => p.generateAddress({ chainId: 56, derivationIndex: 0 })).toThrow(
      /not configured/,
    );
  });

  it('rejects invalid derivation indices', () => {
    const p = new SelfCustodyHdWalletProvider(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    expect(() => p.generateAddress({ chainId: 56, derivationIndex: -1 })).toThrow();
  });
});
