import { ethers } from 'ethers';

// ============================================================
// TRON ADDRESS DERIVATION (TRC-20 / Base58Check)
// ============================================================
// Produces REAL TRON addresses. TRON derives an address from the secp256k1
// public key as follows:
//   keccak256(uncompressed_pubkey_without_0x04_prefix)[-20 bytes]
//   => prepend 0x41 => Base58Check encode.
//
// This is NOT a hash-of-a-string placeholder and is NOT EVM 0x derivation —
// it is the documented TRON address algorithm.

export const TRON_HD_PATH = "m/44'/195'/0'/0";
export const TRON_ADDRESS_PREFIX = 0x41;
export const TRON_ADDRESS_LENGTH = 34;

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58Check-encode a payload (prefixed address bytes). */
export function base58CheckEncode(payload: Uint8Array): string {
  const checksum = ethers
    .getBytes(ethers.sha256(ethers.sha256(payload)))
    .slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(checksum, payload.length);
  return base58Encode(full);
}

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    out = '1' + out;
    zeros++;
  }
  return out;
}

function base58Decode(value: string): Uint8Array {
  let n = 0n;
  for (const ch of value) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid Base58 character');
    n = n * 58n + BigInt(idx);
  }
  let hex = n === 0n ? '00' : n.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  let bytes = ethers.getBytes(`0x${hex}`);

  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros++;
  if (zeros > 0) {
    const padded = new Uint8Array(zeros + bytes.length);
    padded.set(bytes, zeros);
    bytes = padded;
  }
  return bytes;
}

/** Derive a Base58Check TRON address from a 32-byte hex private key. */
export function deriveTronAddressFromPrivateKey(privateKeyHex: string): string {
  const pub = ethers.getBytes(new ethers.SigningKey(privateKeyHex).publicKey);
  const hash = ethers.keccak256(pub.slice(1)); // drop 0x04, hash X||Y
  const last20 = ethers.getBytes(hash).slice(-20);
  const payload = new Uint8Array(21);
  payload[0] = TRON_ADDRESS_PREFIX;
  payload.set(last20, 1);
  return base58CheckEncode(payload);
}

/** Validate a TRON Base58Check address (prefix 0x41, 34 chars, good checksum). */
export function isValidTronAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (address.length !== TRON_ADDRESS_LENGTH) return false;
  if (address[0] !== 'T') return false;
  try {
    const decoded = base58Decode(address);
    if (decoded.length !== 25) return false;
    if (decoded[0] !== TRON_ADDRESS_PREFIX) return false;
    const payload = decoded.slice(0, 21);
    const checksum = decoded.slice(21);
    const expected = ethers
      .getBytes(ethers.sha256(ethers.sha256(payload)))
      .slice(0, 4);
    return expected.every((b, i) => checksum[i] === b);
  } catch {
    return false;
  }
}
