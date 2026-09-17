import { ethers } from 'ethers';

import {
  base58CheckEncode,
  deriveTronAddressFromPrivateKey,
  isValidTronAddress,
  TRON_HD_PATH,
} from './tron-address';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function privateKeyAt(index: number): string {
  const root = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(MNEMONIC),
    TRON_HD_PATH,
  );
  return root.deriveChild(index).privateKey;
}

describe('tron-address', () => {
  it('derives the documented Base58Check TRON address per derivation index', () => {
    expect(deriveTronAddressFromPrivateKey(privateKeyAt(0))).toBe(
      'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    );
    expect(deriveTronAddressFromPrivateKey(privateKeyAt(1))).toBe(
      'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
    );
    expect(deriveTronAddressFromPrivateKey(privateKeyAt(2))).toBe(
      'TYJPRrdB5APNeRs4R7fYZSwW3TcrTKw2gx',
    );
  });

  it('produces 34-char T-prefixed addresses that differ by index', () => {
    const a0 = deriveTronAddressFromPrivateKey(privateKeyAt(0));
    const a1 = deriveTronAddressFromPrivateKey(privateKeyAt(1));
    expect(a0.length).toBe(34);
    expect(a0.startsWith('T')).toBe(true);
    expect(a0).not.toBe(a1);
  });

  it('validates real TRON addresses and rejects EVM / malformed inputs', () => {
    expect(isValidTronAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')).toBe(true);
    expect(isValidTronAddress('TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK')).toBe(true);
    // EVM 0x address must be rejected (wrong format/checksum).
    expect(isValidTronAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')).toBe(false);
    // TRON addresses never start with a digit/other prefix.
    expect(isValidTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
    expect(isValidTronAddress('not-an-address')).toBe(false);
    expect(isValidTronAddress('')).toBe(false);
  });

  it('rejects a checksum-corrupted address', () => {
    const valid = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
    // Flip the final character (part of the checksum).
    const corrupted = valid.slice(0, -1) + (valid.endsWith('H') ? 'J' : 'H');
    expect(isValidTronAddress(corrupted)).toBe(false);
  });

  it('Base58Check-encodes any 0x41-prefixed payload into a valid TRON-format address', () => {
    const payload = Uint8Array.from([
      0x41, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34, 0x56,
      0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34, 0x56, 0x78,
    ]);
    const encoded = base58CheckEncode(payload);
    // A 0x41-prefixed 21-byte payload encodes to a valid 34-char TRON address.
    expect(encoded.length).toBe(34);
    expect(encoded.startsWith('T')).toBe(true);
    expect(isValidTronAddress(encoded)).toBe(true);
  });
});
