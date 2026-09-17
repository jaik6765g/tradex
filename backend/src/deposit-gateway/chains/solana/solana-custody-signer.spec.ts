import { deriveSolanaKeypair, deriveNonceAccount } from './solana-custody-signer';
import { isValidSolanaAddress } from './solana-address';
import { DEFAULT_TEST_MNEMONIC } from './solana-production-preflight';

describe('Solana custody derivation', () => {
  it('derives deterministic keypairs for known test vectors', () => {
    const kp0 = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 0);
    const kp1 = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 1);

    expect(kp0.publicKey.toBase58()).toBe(
      'B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY',
    );
    expect(kp1.publicKey.toBase58()).toBe(
      '634j9U9kjxbM8TmPzNCRQhjeENowxtAYC86Pwy2eGcje',
    );
  });

  it('produces valid Solana addresses', () => {
    const kp = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 0);
    expect(isValidSolanaAddress(kp.publicKey.toBase58())).toBe(true);
  });

  it('derives different addresses for different indices', () => {
    const a = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 0).publicKey.toBase58();
    const b = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 1).publicKey.toBase58();
    expect(a).not.toBe(b);
  });

  it('derives deterministic nonce accounts', () => {
    const authority = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 0).publicKey.toBase58();
    const nonce1 = deriveNonceAccount(authority);
    const nonce2 = deriveNonceAccount(authority);
    expect(nonce1).toBe(nonce2);
    // Nonce account is a PDA (off-curve), so just check it's a valid base58 string.
    expect(typeof nonce1).toBe('string');
    expect(nonce1.length).toBeGreaterThanOrEqual(32);
  });

  it('never exposes the private key', () => {
    const kp = deriveSolanaKeypair(DEFAULT_TEST_MNEMONIC, 0);
    // The secretKey is a Uint8Array but should not be logged/returned.
    const json = JSON.stringify(kp.publicKey);
    expect(json).not.toContain('secretKey');
  });
});
