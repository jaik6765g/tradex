import { ethers } from 'ethers';

import {
  type ChainAdapter,
  type ChainTransactionReceipt,
  type ChainTransferLog,
} from '../chain-adapter.interface';
import type { NetworkConfig } from '../../networks/network-registry.service';

export class EvmDepositAdapter implements ChainAdapter {
  private readonly transferInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);
  private readonly providers: ethers.JsonRpcProvider[] = [];
  private activeIndex = 0;

  constructor(private readonly network: NetworkConfig) {
    for (const url of this.network.rpcUrls) {
      this.providers.push(
        new ethers.JsonRpcProvider(url, this.network.chainId as number, {
          staticNetwork: true,
        }),
      );
    }
    if (this.providers.length === 0) {
      throw new Error(`No RPC configured for network ${this.network.id}`);
    }
  }

  getChainId(): number {
    return this.network.chainId as number;
  }

  getNativeSymbol(): string {
    return this.network.nativeSymbol;
  }

  getTokenAddress(_asset: string): string {
    return this.network.usdtContract;
  }

  getTokenDecimals(_asset: string): number {
    return this.network.usdtDecimals;
  }

  validateAddress(address: string): boolean {
    try {
      ethers.getAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  getRequiredConfirmations(): number {
    return this.network.confirmations;
  }

  async getCurrentBlock(): Promise<number> {
    return this.withFailover((p) => p.getBlockNumber(), 'getBlockNumber');
  }

  async getTransferLogs(
    tokenAddress: string,
    fromBlock: number,
    toBlock: number,
    recipientAddresses: string[],
  ): Promise<ChainTransferLog[]> {
    const normalized = recipientAddresses.map((a) => ethers.getAddress(a));
    const logs = await this.withFailover(
      (p) =>
        p.getLogs({
          address: tokenAddress,
          fromBlock,
          toBlock,
          topics: [
            ethers.id('Transfer(address,address,uint256)'),
            null,
            normalized.map((a) => ethers.zeroPadValue(a, 32)),
          ],
        }),
      'getLogs',
    );

    const transfers: ChainTransferLog[] = [];
    for (const log of logs) {
      let parsed: ethers.LogDescription | null = null;
      try {
        parsed = this.transferInterface.parseLog({
          topics: log.topics,
          data: log.data,
        });
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== 'Transfer') continue;
      transfers.push({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        from: ethers.getAddress(parsed.args[0] as string),
        to: ethers.getAddress(parsed.args[1] as string),
        tokenAddress: log.address,
        amount: (parsed.args[2] as bigint).toString(),
      });
    }
    return transfers;
  }

  async getTransactionReceipt(
    txHash: string,
  ): Promise<ChainTransactionReceipt | null> {
    const receipt = await this.withFailover(
      (p) => p.getTransactionReceipt(txHash),
      `getTransactionReceipt(${txHash})`,
    );
    if (!receipt) return null;
    return {
      status: receipt.status ?? null,
      blockNumber: receipt.blockNumber,
      transactionHash: receipt.hash,
    };
  }

  async getBlockTimestamp(blockNumber: number): Promise<number> {
    const block = await this.withFailover(
      (p) => p.getBlock(blockNumber),
      `getBlock(${blockNumber})`,
    );
    if (!block) throw new Error(`Block not found: ${blockNumber}`);
    return block.timestamp;
  }

  async getConfirmations(blockNumber: number): Promise<number> {
    const current = await this.getCurrentBlock();
    return Math.max(0, current - blockNumber + 1);
  }

  async getNativeBalance(address: string): Promise<bigint> {
    return this.withFailover((p) => p.getBalance(address), 'getBalance');
  }

  /**
   * ERC20 balanceOf via a read-only eth_call (bigint result, smallest unit).
   * Used by read-only reconciliation. Malformed responses are surfaced as
   * explicit errors instead of silently returning 0.
   */
  async getTokenBalance(
    tokenAddress: string,
    holderAddress: string,
  ): Promise<bigint> {
    const iface = new ethers.Interface([
      'function balanceOf(address) view returns (uint256)',
    ]);
    const data = iface.encodeFunctionData('balanceOf', [
      ethers.getAddress(holderAddress),
    ]);
    const result = await this.withFailover(
      (p) => p.call({ to: ethers.getAddress(tokenAddress), data }),
      `balanceOf(${holderAddress})`,
    );
    try {
      const [balance] = iface.decodeFunctionResult('balanceOf', result);
      return BigInt(balance);
    } catch {
      throw new Error(
        `Malformed balanceOf response for token ${tokenAddress}`,
      );
    }
  }

  async getNonce(address: string): Promise<number> {
    return this.withFailover(
      (p) => p.getTransactionCount(address),
      'getTransactionCount',
    );
  }

  async getGasPrice(): Promise<bigint> {
    const feeData = await this.withFailover((p) => p.getFeeData(), 'getFeeData');
    return feeData.gasPrice ?? 0n;
  }

  async sendRawTransaction(signedTransaction: string): Promise<string> {
    const response = await this.withFailover(
      (p) => p.broadcastTransaction(signedTransaction),
      'broadcastTransaction',
    );
    return response.hash;
  }

  private async withFailover<T>(
    operation: (provider: ethers.JsonRpcProvider) => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.activeIndex + i) % this.providers.length;
      try {
        const result = await operation(this.providers[idx]);
        this.activeIndex = idx;
        return result;
      } catch (error) {
        lastError = error;
        if (this.isRpcError(error)) continue;
        throw error;
      }
    }
    throw lastError;
  }

  private isRpcError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('dns') ||
      message.includes('network error') ||
      message.includes('429') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('socket hang up') ||
      message.includes('fetch failed')
    );
  }
}
