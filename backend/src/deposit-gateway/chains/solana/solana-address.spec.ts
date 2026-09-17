import {
  deriveSolanaAddress,
  isValidSolanaAddress,
  solanaPathForIndex,
} from './solana-address';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('solana-address', () => {
  it('derives deterministic BIP44 Ed25519 addresses', () => {
    expect(deriveSolanaAddress(MNEMONIC, 0)).toBe('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY');
    expect(deriveSolanaAddress(MNEMONIC, 1)).toBe('634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje');
    // deterministic: same index → same address
    expect(deriveSolanaAddress(MNEMONIC, 0)).toBe(deriveSolanaAddress(MNEMONIC, 0));
    // different indices → different addresses
    expect(deriveSolanaAddress(MNEMONIC, 0)).not.toBe(deriveSolanaAddress(MNEMONIC, 1));
  });

  it('builds hardened SLIP-10 derivation paths', () => {
    expect(solanaPathForIndex(0)).toBe("m/44'/501'/0'/0'/0'");
    expect(solanaPathForIndex(7)).toBe("m/44'/501'/0'/0'/7'");
  });

  it('validates Solana addresses and rejects EVM/TRON/malformed/zero-like values', () => {
    expect(isValidSolanaAddress('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY')).toBe(true);
    expect(isValidSolanaAddress('634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje')).toBe(true);
    // EVM and TRON addresses must never pass Solana validation.
    expect(isValidSolanaAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')).toBe(false);
    expect(isValidSolanaAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')).toBe(false);
    // empty / too-short / non-base58.
    expect(isValidSolanaAddress('')).toBe(false);
    expect(isValidSolanaAddress('short')).toBe(false);
    // 'O' and '0' are excluded from the base58 alphabet → decode throws.
    expect(isValidSolanaAddress('O'.repeat(32))).toBe(false);
    expect(isValidSolanaAddress('0'.repeat(32))).toBe(false);
  });
});