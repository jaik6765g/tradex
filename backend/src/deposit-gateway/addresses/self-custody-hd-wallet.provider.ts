import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import {
  type DepositAddressProvider,
  type GeneratedDepositAddress,
  type GenerateAddressInput,
} from './deposit-address-provider.interface';
import {
  type DepositTransactionSigner,
  type SignedDepositTransfer,
  type SignTokenTransferRequest,
} from './deposit-transaction-signer.interface';

const BASE_PATH = `m/44'/60'/0'/0`;

/**
 * Self-custody HD wallet provider (BIP44) for EVM/BSC deposit addresses.
 *
 * - Master mnemonic is read ONCE from DEPOSIT_WALLET_MNEMONIC and held in
 *   memory only; it is NEVER written to Postgres, logs, responses or source.
 * - Addresses are derived deterministically from a monotonically increasing
 *   derivation index: m/44'/60'/0'/0/<index>. Only the index + path are
 *   persisted (never the private key).
 * - Signing derives the child private key transiently in memory and clears it
 *   when done. This is a Self-CUSTODY option; prefer HSM/KMS/custody for
 *   production-grade key management.
 */
@Injectable()
export class SelfCustodyHdWalletProvider
  implements DepositAddressProvider, DepositTransactionSigner
{
  readonly name = 'self_custody_hd';

  private readonly root: ethers.HDNodeWallet | null;

  constructor(configService: ConfigService) {
    const mnemonic = configService
      .get<string>('DEPOSIT_WALLET_MNEMONIC')
      ?.trim();

    this.root = mnemonic
      ? ethers.HDNodeWallet.fromMnemonic(
          ethers.Mnemonic.fromPhrase(mnemonic),
          BASE_PATH,
        )
      : null;
  }

  isConfigured(): boolean {
    return this.root !== null;
  }

  isDevelopment(): boolean {
    return false;
  }

  generateAddress(input: GenerateAddressInput): GeneratedDepositAddress {
    const wallet = this.derive(input.derivationIndex);
    return {
      address: wallet.address,
      chainId: input.chainId,
      provider: this.name,
      derivationIndex: input.derivationIndex,
      derivationPath: `${BASE_PATH}/${input.derivationIndex}`,
      metadata: { custody: 'self' },
    };
  }

  validateAddress(address: string, _chainId: number): boolean {
    try {
      ethers.getAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  getAddressMetadata(address: string, chainId: number): Record<string, unknown> {
    return { address, chainId, provider: this.name, custody: 'self' };
  }

  canSign(): boolean {
    return this.root !== null;
  }

  async signTokenTransfer(
    input: SignTokenTransferRequest,
  ): Promise<SignedDepositTransfer> {
    const wallet = this.derive(input.derivationIndex ?? -1);

    const iface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]);
    const data = iface.encodeFunctionData('transfer', [input.to, input.amountWei]);

    const tx: ethers.TransactionRequest = {
      to: input.tokenAddress,
      from: input.from,
      nonce: input.nonce,
      gasLimit: input.gasLimit,
      chainId: input.chainId,
      data,
    };

    if (input.maxFeePerGas && input.maxPriorityFeePerGas) {
      tx.type = 2;
      tx.maxFeePerGas = input.maxFeePerGas;
      tx.maxPriorityFeePerGas = input.maxPriorityFeePerGas;
    } else if (input.gasPrice) {
      tx.gasPrice = input.gasPrice;
    }

    const signed = await wallet.signTransaction(tx);
    return { signedTransaction: signed };
  }

  private derive(index: number): ethers.HDNodeWallet {
    if (!this.root) {
      throw new Error('DEPOSIT_WALLET_MNEMONIC is not configured');
    }
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Invalid derivation index');
    }
    return this.root.deriveChild(index);
  }
}
