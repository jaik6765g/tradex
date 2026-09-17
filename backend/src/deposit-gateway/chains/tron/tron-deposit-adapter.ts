import { ethers } from 'ethers';

import type { NetworkConfig } from '../../networks/network-registry.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import { isValidTronAddress } from './tron-address';

// ============================================================
// TRON DEPOSIT ADAPTER (TRC-20 USDT on TronGrid REST API)
// ============================================================
// Provides the TRON-specific chain operations the gateway needs WITHOUT
// pretending TRON is EVM: TRC-20 transfers come from TronGrid's account API
// (paginated by ms timestamp), finality is derived from gettransactioninfobyid's
// blockNumber vs getnowblock, and amounts use configured 6-decimal USDT.

export interface TronTrc20Transfer {
  txId: string;
  from: string;
  to: string;
  tokenAddress: string;
  /** Raw amount in smallest unit (string; USDT uses 6 decimals). */
  amountRaw: string;
  decimals: number;
  /** Block timestamp (ms). */
  blockTimestamp: number;
}

export interface TronTransactionInfo {
  blockNumber: number;
  success: boolean;
}

/** Format a raw smallest-unit amount into human USDT units (6 decimals). */
export function formatUsdtUnits(raw: string, decimals: number): string {
  return ethers.formatUnits(BigInt(raw), decimals);
}

/** Format raw USDT into TDX at the configured rate (1 USDT = 100 TDX). */
export function formatTdxUnits(
  raw: string,
  decimals: number,
  tdxRate: number,
): string {
  return ethers.formatUnits(BigInt(raw) * BigInt(tdxRate), decimals);
}

export class TronDepositAdapter {
  constructor(
    private readonly network: NetworkConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly apiKey?: string,
  ) {}

  getChainId(): number {
    return TRON_CHAIN_ID;
  }

  getTokenAddress(): string {
    return this.network.usdtContract;
  }

  getTokenDecimals(): number {
    return this.network.usdtDecimals;
  }

  getRequiredConfirmations(): number {
    return this.network.confirmations;
  }

  validateAddress(address: string): boolean {
    return isValidTronAddress(address);
  }

  async getCurrentBlock(): Promise<number> {
    const res = await this.request('/wallet/getnowblock', { method: 'POST' });
    const number = res?.block_header?.raw_data?.number;
    if (typeof number !== 'number' && typeof number !== 'string') {
      throw new Error('Invalid getnowblock response from TRON RPC');
    }
    return Number(number);
  }

  /** TRX native balance (sun) of an address, for TRC-20 gas accounting. */
  async getNativeBalance(address: string): Promise<bigint> {
    const res = await this.request(`/v1/accounts/${address}`, { method: 'GET' });
    const raw = res?.data?.[0]?.balance;
    if (typeof raw === 'undefined') {
      throw new Error('TRON account balance not found');
    }
    return BigInt(String(raw));
  }

  async getTransactionInfo(txId: string): Promise<TronTransactionInfo> {
    const res = await this.request('/wallet/gettransactioninfobyid', {
      method: 'POST',
      body: { value: txId },
    });
    if (!res) {
      throw new Error('TRON transaction not found');
    }
    const blockNumber = Number(res.blockNumber);
    if (!Number.isInteger(blockNumber)) {
      throw new Error('TRON transaction has no block yet');
    }
    const result = res.receipt?.result ?? res.contractRet;
    const success = !result || result === 'SUCCESS';
    return { blockNumber, success };
  }

  async getTrc20Transfers(
    address: string,
    opts: { minTimestamp?: number; limit?: number } = {},
  ): Promise<TronTrc20Transfer[]> {
    const params = new URLSearchParams();
    params.set('only_confirmed', 'true');
    params.set('limit', String(opts.limit ?? 200));
    params.set('contract_address', this.network.usdtContract);
    if (opts.minTimestamp) {
      params.set('min_timestamp', String(opts.minTimestamp));
    }

    const res = await this.request(
      `/v1/accounts/${address}/transactions/trc20?${params.toString()}`,
      { method: 'GET' },
    );
    return this.parseTrc20Page(res);
  }

  /**
   * Paged variant: fetches all matching TRC-20 transfers for an address,
   * advancing a timestamp cursor past returned pages until a short page is
   * returned or maxPages is reached. Deduplicates by tx id. Bounded so a
   * pathological address can never cause unbounded RPC traffic.
   */
  async getAllTrc20Transfers(
    address: string,
    opts: { minTimestamp?: number; pageSize?: number; maxPages?: number } = {},
  ): Promise<TronTrc20Transfer[]> {
    const pageSize = opts.pageSize ?? 200;
    const maxPages = Math.max(1, opts.maxPages ?? 20);
    const seen = new Set<string>();
    const all: TronTrc20Transfer[] = [];
    let cursor = opts.minTimestamp;

    for (let page = 0; page < maxPages; page++) {
      const pageTransfers = await this.getTrc20Transfers(address, {
        minTimestamp: cursor,
        limit: pageSize,
      });
      if (pageTransfers.length === 0) break;

      let added = 0;
      let maxTs = 0;
      for (const t of pageTransfers) {
        maxTs = Math.max(maxTs, t.blockTimestamp);
        if (seen.has(t.txId)) continue;
        seen.add(t.txId);
        all.push(t);
        added++;
      }

      if (pageTransfers.length < pageSize || added === 0) break;
      cursor = maxTs + 1;
    }
    return all;
  }

  private parseTrc20Page(res: any): TronTrc20Transfer[] {
    const out: TronTrc20Transfer[] = [];
    for (const t of res?.data ?? []) {
      const tokenAddress = t?.token_info?.address;
      // Only the configured TRC-20 USDT contract.
      if (tokenAddress && tokenAddress !== this.network.usdtContract) continue;
      if (t?.type && t.type !== 'Transfer') continue;
      out.push({
        txId: t.transaction_id,
        from: t.from,
        to: t.to,
        tokenAddress: tokenAddress ?? this.network.usdtContract,
        amountRaw: String(t.value),
        decimals: Number(t?.token_info?.decimals ?? this.network.usdtDecimals),
        blockTimestamp: Number(t.block_timestamp ?? 0),
      });
    }
    return out;
  }

  /** TRC-20 USDT balance (smallest unit) of an address, for reconciliation. */
  async getTokenBalance(address: string): Promise<bigint> {
    const res = await this.request(`/v1/accounts/${address}`, { method: 'GET' });
    const trc20 = res?.data?.[0]?.trc20;
    if (Array.isArray(trc20)) {
      for (const item of trc20) {
        if (item && typeof item === 'object') {
          const key = Object.keys(item)[0];
          if (key === this.network.usdtContract) {
            return BigInt(String(item[key] ?? '0'));
          }
        }
      }
    }
    return 0n;
  }

  private get baseUrl(): string {
    const url = this.network.rpcUrls[0];
    if (!url) throw new Error('TRON RPC is not configured');
    return url.replace(/\/+$/, '');
  }

  private async request(
    path: string,
    opts: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['TRON-PRO-API-KEY'] = this.apiKey;
    }

    let lastError: unknown;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const init: RequestInit = { method: opts.method, headers };
        if (opts.method === 'POST') {
          init.body = JSON.stringify(opts.body ?? {});
        }
        if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
          init.signal = AbortSignal.timeout(15000);
        }

        const res = await this.fetchFn(`${this.baseUrl}${path}`, init);
        if (!res.ok) {
          const retryable =
            res.status === 429 ||
            res.status === 500 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504;
          if (retryable && attempt < maxAttempts) {
            await this.sleep(attempt * 1000);
            continue;
          }
          throw new Error(`TRON RPC failed (${res.status}) for ${path}`);
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          message.includes('timeout') ||
          message.includes('abort') ||
          message.includes('rate limit') ||
          message.includes('fetch failed') ||
          message.includes('econnrefused') ||
          message.includes('econnreset') ||
          message.includes('enotfound');
        if (retryable && attempt < maxAttempts) {
          await this.sleep(attempt * 1000);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
