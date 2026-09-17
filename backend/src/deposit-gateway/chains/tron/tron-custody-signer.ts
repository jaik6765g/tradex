import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import { TRON_HD_PATH } from './tron-address';
import { DEFAULT_TEST_MNEMONIC } from './tron-production-preflight';

// ============================================================
// TRON CUSTODY SIGNER (TRC-20 USDT transfer)
// ============================================================
// Signs a TRON `triggerSmartContract` transaction that calls
// USDT.transfer(to, amount). Uses the maintained `tronweb` SDK (lazily
// imported so the gateway/tests only load it when actually signing).
//
// SECURITY:
// - The private key is derived transiently in memory from the configured
//   mnemonic at m/44'/195'/0'/0/<derivationIndex> and is NEVER persisted,
//   logged, or returned.
// - Only the derivation index/path is stored (deposit_addresses).

interface TronWebLike {
  TronWeb: new (opts: Record<string, unknown>) => {
    address: { fromPrivateKey: (key: string) => string };
    transactionBuilder: {
      triggerSmartContract: (
        contractAddress: string,
        functionSelector: string,
        options: Record<string, unknown>,
        parameters: Array<{ type: string; value: string }>,
        issuerAddress: string,
      ) => Promise<{ transaction: Record<string, unknown> }>;
    };
    trx: {
      sign: (
        transaction: Record<string, unknown>,
        privateKey: string,
      ) => Promise<Record<string, unknown>>;
      broadcast: (
        signed: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };
  };
}

export interface SignTrc20Input {
  rpcUrl: string;
  tokenAddress: string;
  /** Sender = deposit address (base58). */
  from: string;
  /** Recipient = TRON treasury (base58). */
  to: string;
  /** Raw smallest-unit USDT amount (6 decimals). */
  amountSun: string;
  /** HD derivation index of the deposit address. */
  derivationIndex: number;
  /** Max TRX fee (sun) the transaction is willing to burn. */
  feeLimitSun: string;
}

export interface SignedTronTransaction {
  signed: Record<string, unknown>;
  txID: string;
}

@Injectable()
export class TronCustodySigner {
  private readonly mnemonic: string | null;

  constructor(private readonly configService: ConfigService) {
    this.mnemonic =
      configService.get<string>('TRON_DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      configService.get<string>('DEPOSIT_WALLET_MNEMONIC')?.trim() ||
      null;
  }

  isConfigured(): boolean {
    return Boolean(this.mnemonic);
  }

  canSign(): boolean {
    return this.isConfigured();
  }

  /** True when the configured phrase is the well-known public test mnemonic. */
  isDefaultTestMnemonic(): boolean {
    return Boolean(this.mnemonic && this.mnemonic.trim() === DEFAULT_TEST_MNEMONIC);
  }

  /** Build + sign a TRC-20 USDT transfer (deposit address -> treasury). */
  async signTrc20Transfer(input: SignTrc20Input): Promise<SignedTronTransaction> {
    if (!this.mnemonic) {
      throw new Error(
        'TRON_DEPOSIT_WALLET_MNEMONIC (or DEPOSIT_WALLET_MNEMONIC) is not configured',
      );
    }
    if (!Number.isInteger(input.derivationIndex) || input.derivationIndex < 0) {
      throw new Error('Invalid TRON derivation index');
    }

    const privateKey = this.derivePrivateKey(input.derivationIndex);
    const client = new (await this.tronWebLib()).TronWeb({
      fullHost: input.rpcUrl,
      privateKey,
    });

    const built = await client.transactionBuilder.triggerSmartContract(
      input.tokenAddress,
      'transfer(address,uint256)',
      { feeLimit: input.feeLimitSun, callValue: '0' },
      [
        { type: 'address', value: input.to },
        { type: 'uint256', value: input.amountSun },
      ],
      input.from,
    );

    const signed = await client.trx.sign(built.transaction, privateKey);
    return {
      signed,
      txID: String((signed as { txID?: unknown }).txID ?? ''),
    };
  }

  /** Broadcast a previously signed TRON transaction; returns the tx hash. */
  async broadcastSigned(
    signed: Record<string, unknown>,
    rpcUrl: string,
  ): Promise<string> {
    const client = new (await this.tronWebLib()).TronWeb({ fullHost: rpcUrl });
    const result = await client.trx.broadcast(signed);
    const txid =
      result.txid ??
      (result.result as Record<string, unknown> | undefined)?.txid ??
      result.id ??
      (result.transaction as { txID?: unknown } | undefined)?.txID;
    if (!txid) {
      throw new Error('TRON broadcast returned no transaction hash');
    }
    return String(txid);
  }

  /** Safe public address derivation for an index (never exposes the key). */
  async deriveAddressForIndex(derivationIndex: number): Promise<string> {
    if (!this.mnemonic) {
      throw new Error(
        'TRON_DEPOSIT_WALLET_MNEMONIC (or DEPOSIT_WALLET_MNEMONIC) is not configured',
      );
    }
    const key = this.derivePrivateKey(derivationIndex);
    const client = new (await this.tronWebLib()).TronWeb({ fullHost: 'https://x' });
    return client.address.fromPrivateKey(key);
  }

  private derivePrivateKey(derivationIndex: number): string {
    if (!this.mnemonic) {
      throw new Error(
        'TRON_DEPOSIT_WALLET_MNEMONIC (or DEPOSIT_WALLET_MNEMONIC) is not configured',
      );
    }
    const root = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(this.mnemonic),
      TRON_HD_PATH,
    );
    return root.deriveChild(derivationIndex).privateKey.replace('0x', '');
  }

  private async tronWebLib(): Promise<TronWebLike> {
    const mod = (await import('tronweb')) as unknown as TronWebLike;
    return mod;
  }
}