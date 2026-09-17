import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { DEFAULT_TEST_MNEMONIC } from './solana-production-preflight';

const HARDENED = 0x80000000;

export interface SolanaSweepInput {
  rpcUrl: string;
  mint: string;
  from: string;
  to: string;
  amountRaw: string;
  derivationIndex: number;
  nonceAccount: string;
  nonceBlockhash: string;
  feeLamports: string;
}

export interface SignedSolanaTransaction {
  txId: string;
  signedBase64: string;
}

function ser32(index: number): Uint8Array {
  return Uint8Array.from([
    (index >> 24) & 0xff,
    (index >> 16) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
  ]);
}

function slip10Ed25519(seed: Uint8Array, indices: number[]): Uint8Array {
  const master = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = master.slice(0, 32);
  let chain = master.slice(32, 64);
  for (const rawIndex of indices) {
    const index = rawIndex | HARDENED;
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    data.set(ser32(index), 33);
    const I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32, 64);
  }
  return key.slice(0, 32);
}

function deriveSolanaPrivateKey(mnemonic: string, index: number): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic.trim());
  return slip10Ed25519(seed, [44, SOLANA_CHAIN_ID, 0, 0, index]);
}

export function deriveSolanaKeypair(mnemonic: string, index: number): Keypair {
  return Keypair.fromSeed(deriveSolanaPrivateKey(mnemonic, index));
}

export function deriveNonceAccount(authority: string): string {
  const authorityKey = new PublicKey(authority);
  const [nonce] = PublicKey.findProgramAddressSync(
    [authorityKey.toBuffer()],
    new PublicKey('11111111111111111111111111111111'),
  );
  return nonce.toBase58();
}

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

@Injectable()
export class SolanaCustodySigner {
  private readonly mnemonic: string | null;

  constructor(private readonly configService: ConfigService) {
    this.mnemonic =
      configService.get<string>('SOLANA_DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      configService.get<string>('DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      null;

    const env = (configService.get<string>('NODE_ENV') ?? 'development')
      .trim()
      .toLowerCase();
    if (
      env === 'production' &&
      this.mnemonic &&
      this.mnemonic.trim() === DEFAULT_TEST_MNEMONIC
    ) {
      throw new Error(
        'production must not use the public test mnemonic; configure a secure SOLANA_DEPOSIT_WALLET_MNEMONIC',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.mnemonic);
  }

  canSign(): boolean {
    return this.isConfigured();
  }

  isDefaultTestMnemonic(): boolean {
    return Boolean(
      this.mnemonic && this.mnemonic.trim() === DEFAULT_TEST_MNEMONIC,
    );
  }

  /** Safe public address derivation for an index (never exposes the key). */
  deriveAddressForIndex(derivationIndex: number): string {
    if (!this.mnemonic) {
      throw new Error('SOLANA_DEPOSIT_WALLET_MNEMONIC is not configured');
    }
    return deriveSolanaKeypair(this.mnemonic, derivationIndex)
      .publicKey.toBase58();
  }

  /** Build + sign an SPL USDT transfer inside a durable-nonce transaction. */
  async signSplTransfer(
    input: SolanaSweepInput,
  ): Promise<SignedSolanaTransaction> {
    if (!this.mnemonic) {
      throw new Error('SOLANA_DEPOSIT_WALLET_MNEMONIC is not configured');
    }
    if (!Number.isInteger(input.derivationIndex) || input.derivationIndex < 0) {
      throw new Error('Invalid Solana derivation index');
    }

    const keypair = deriveSolanaKeypair(this.mnemonic, input.derivationIndex);
    const fromPubkey = keypair.publicKey;

    if (fromPubkey.toBase58() !== input.from) {
      throw new Error(
        `Derived address ${fromPubkey.toBase58()} does not match expected ${input.from}`,
      );
    }

    const mint = new PublicKey(input.mint);
    const treasury = new PublicKey(input.to);
    const sourceAta = getAssociatedTokenAddressSync(mint, fromPubkey);
    const destAta = getAssociatedTokenAddressSync(mint, treasury);
    const amount = BigInt(input.amountRaw);

    if (amount <= 0n) {
      throw new Error('Sweep amount must be positive');
    }

    const advanceNonce = SystemProgram.nonceAdvance({
      noncePubkey: new PublicKey(input.nonceAccount),
      authorizedPubkey: fromPubkey,
    });

    const transferIx = buildSplTransferInstruction(
      sourceAta,
      destAta,
      fromPubkey,
      amount,
    );

    const message = new TransactionMessage({
      payerKey: fromPubkey,
      recentBlockhash: input.nonceBlockhash,
      instructions: [advanceNonce, transferIx],
    });

    const tx = new VersionedTransaction(message.compileToV0Message());
    tx.sign([keypair]);

    const sig = tx.signatures[0];
    if (!sig) {
      throw new Error('Solana signing produced no signature');
    }

    return {
      txId: base58Encode(sig),
      signedBase64: Buffer.from(tx.serialize()).toString('base64'),
    };
  }
}

function buildSplTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
) {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // instruction 3 = transfer
  data.writeBigUInt64LE(amount, 1);

  return {
    programId: new PublicKey(SPL_TOKEN_PROGRAM),
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let x = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let output = '';
  while (x > 0n) {
    const mod = Number(x % 58n);
    output = ALPHABET[mod] + output;
    x = x / 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output = '1' + output;
  }
  return output;
}
