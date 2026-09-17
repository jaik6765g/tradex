// ============================================================
// CHAIN ADAPTER
// ============================================================
//
// All blockchain reads (block number, logs, receipts, confirmations) go
// through a ChainAdapter so the gateway can support BSC / Ethereum / Polygon
// without rewriting the gateway. Each chain owns its RPC, token contracts,
// event format, confirmation policy and address validation rules.
// ============================================================

export interface ChainTransferLog {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  from: string;
  to: string;
  tokenAddress: string;
  /** Raw token amount (smallest unit, e.g. wei). */
  amount: string;
}

export interface ChainTransactionReceipt {
  status: number | null;
  blockNumber: number;
  transactionHash: string;
}

export interface ChainAdapter {
  getChainId(): number;

  getNativeSymbol(): string;

  getTokenAddress(asset: string): string;

  getTokenDecimals(asset: string): number;

  validateAddress(address: string): boolean;

  getCurrentBlock(): Promise<number>;

  getTransferLogs(
    tokenAddress: string,
    fromBlock: number,
    toBlock: number,
    recipientAddresses: string[],
  ): Promise<ChainTransferLog[]>;

  getTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null>;

  getBlockTimestamp(blockNumber: number): Promise<number>;

  getConfirmations(blockNumber: number): Promise<number>;

  getRequiredConfirmations(): number;

  /**
   * Optional: ERC20/SPL token balance (smallest unit) of `holderAddress` for
   * `tokenAddress`. Implemented by adapters that support balanceOf-style reads
   * (EVM). Used by read-only reconciliation — never mutates state.
   */
  getTokenBalance?(
    tokenAddress: string,
    holderAddress: string,
  ): Promise<bigint>;

  /** Native balance (wei) of an address, for gas accounting. */
  getNativeBalance(address: string): Promise<bigint>;

  getNonce(address: string): Promise<number>;

  getGasPrice(): Promise<bigint>;

  sendRawTransaction(signedTransaction: string): Promise<string>;
}

export const CHAIN_ADAPTERS = 'CHAIN_ADAPTERS';
