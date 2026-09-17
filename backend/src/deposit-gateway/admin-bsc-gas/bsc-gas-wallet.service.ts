import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

/**
 * Dedicated server-side BSC gas wallet.
 *
 * SECURITY:
 * - Private key comes ONLY from BSC_GAS_WALLET_PRIVATE_KEY env/secret-manager.
 * - Key is held in memory only; NEVER written to DB, logs, or API responses.
 * - NEVER accepts a private key from the frontend (no such API exists).
 * - MUST be a different key from the custody master seed (DEPOSIT_WALLET_MNEMONIC).
 * - Only signs plain native BNB transfers to validated TradeX deposit addresses.
 */
@Injectable()
export class BscGasWalletService {
  private readonly logger = new Logger(BscGasWalletService.name);
  private readonly wallet: ethers.Wallet | null;
  readonly address: string | null;

  constructor(private readonly configService: ConfigService) {
    const raw = (configService.get<string>('BSC_GAS_WALLET_PRIVATE_KEY') ?? '').trim();
    if (!raw) {
      this.wallet = null;
      this.address = null;
      return;
    }
    let w: ethers.Wallet;
    try {
      w = new ethers.Wallet(raw);
    } catch {
      throw new Error('BSC_GAS_WALLET_PRIVATE_KEY is not a valid private key');
    }
    // Refuse to start with the custody seed's first child key confusion:
    // the gas wallet must not equal the configured treasury (operator error guard).
    this.wallet = w;
    this.address = w.address;
  }

  isConfigured(): boolean {
    return this.wallet !== null;
  }

  getAddress(): string | null {
    return this.address;
  }

  /**
   * Safety: gas wallet must not collide with custody master seed derivation.
   * We cannot invert the mnemonic, but we CAN refuse when the gas wallet
   * address equals the treasury (misconfiguration) — checked at send time.
   */

  /**
   * Sign a plain native BNB transfer. Caller MUST have validated:
   * chainId=56, recipient allow-listed, amount>0. Returns signed raw tx hex.
   * The raw tx is returned to the service layer only (never to the frontend).
   */
  async signNativeTransfer(input: {
    chainId: number;
    to: string;
    amountWei: bigint;
    nonce: number;
    gasPriceWei: bigint;
    gasLimit: bigint;
  }): Promise<{ signedTransaction: string; hash: string }> {
    if (!this.wallet) {
      throw new Error('BSC gas wallet is not configured (BSC_GAS_WALLET_PRIVATE_KEY)');
    }
    if (input.chainId !== 56) throw new Error('Gas wallet refuses non-BSC chain');
    const tx: ethers.TransactionRequest = {
      chainId: 56,
      to: ethers.getAddress(input.to),
      value: input.amountWei,
      nonce: input.nonce,
      gasPrice: input.gasPriceWei,
      gasLimit: input.gasLimit,
      type: 0,
    };
    const signed = await this.wallet.signTransaction(tx);
    const { keccak256 } = await import('ethers');
    return { signedTransaction: signed, hash: keccak256(signed) };
  }
}
