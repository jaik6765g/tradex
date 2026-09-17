// ============================================================
// DEPOSIT TRANSACTION SIGNER
// ============================================================
//
// Signs sweep transfers WITHOUT exposing the private key. Self-custody
// derives the child private key transiently in memory (never persisted);
// future custody providers would call the custody API to sign.

export const DEPOSIT_TRANSACTION_SIGNER = 'DEPOSIT_TRANSACTION_SIGNER';

export interface SignedDepositTransfer {
  /** Raw signed transaction (hex) to broadcast via the chain adapter. */
  signedTransaction: string;
}

export interface SignTokenTransferRequest {
  chainId: number;
  /** Sender = deposit address. */
  from: string;
  /** Recipient = treasury. */
  to: string;
  tokenAddress: string;
  /** Raw token amount (smallest unit). */
  amountWei: string;
  /** HD derivation index of the sender (self-custody only). */
  derivationIndex?: number;
  nonce: number;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface DepositTransactionSigner {
  readonly name: string;

  canSign(): boolean;

  signTokenTransfer(
    input: SignTokenTransferRequest,
  ): Promise<SignedDepositTransfer>;
}
