import { mnemonicToSeedSync } from '@scure/bip39';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { Keypair, PublicKey } from '@solana/web3.js';

import { SOLANA_CHAIN_ID } from '../../config/networks.config';

// ============================================================
// SOLANA ADDRESS DERIVATION (Ed25519 / SLIP-0010 / BIP44 coin 501)
// ============================================================
// Solana uses Ed25519 keys (NOT secp256k1/BIP32). Addresses are the
// base58-encoded 32-byte Ed25519 public key.
//
// Derivation: BIP39 mnemonic → 64-byte seed → SLIP-0010 ed25519
// m/44'/501'/0'/0'/<index>' → 32-byte child key → pubkey.
// The seed/private key never leaves the provider/server side.

export const SOLANA_CHAIN = SOLANA_CHAIN_ID;
export const SOLANA_HD_PATH_PREFIX = "m/44'/501'/0'/0'";

const HARDENED = 0x80000000;

/** SLIP-10 path string for a per-user/network address index (hardened). */
export function solanaPathForIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Invalid Solana derivation index');
  }
  return `${SOLANA_HD_PATH_PREFIX}/${index}'`;
}

function ser32(index: number): Uint8Array {
  return Uint8Array.from([
    (index >> 24) & 0xff,
    (index >> 16) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
  ]);
}

/** SLIP-0010 ed25519 master + hardened-child derivation. */
function slip10PrivateKey(seed: Uint8Array, indices: number[]): Uint8Array {
  const master = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = master.slice(0, 32);
  let chain = master.slice(32, 64);

  for (const rawIndex of indices) {
    const index = rawIndex | HARDENED;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00; // ed25519: P(kpar) = 0x00 || kpar
    data.set(key, 1);
    data.set(ser32(index), 33);
    const I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32, 64);
  }
  return key.slice(0, 32);
}

/** Derive the 32-byte Ed25519 child private key for an address index. */
export function deriveSolanaPrivateKey(mnemonic: string, index: number): Uint8Array {
  // English BIP39 (default wordlist in @scure/bip39).
  const seed = mnemonicToSeedSync(mnemonic.trim());
  return slip10PrivateKey(seed, [44, SOLANA_CHAIN, 0, 0, index]);
}

/** Derive the Solana public deposit address (base58 pubkey) for an index. */
export function deriveSolanaAddress(mnemonic: string, index: number): string {
  return Keypair.fromSeed(deriveSolanaPrivateKey(mnemonic, index)).publicKey.toString();
}

/** Strict Solana address validation: base58 → 32 bytes → on-curve Ed25519. */
export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (address.length < 32 || address.length > 44) return false;
  if (address.startsWith('0x') || address.startsWith('T')) return false;
  try {
    const bytes = new PublicKey(address).toBytes();
    if (bytes.length !== 32) return false;
    return PublicKey.isOnCurve(bytes);
  } catch {
    return false;
  }
}