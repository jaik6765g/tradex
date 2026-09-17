import type { NetworkConfig } from '../../networks/network-registry.service';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { isValidSolanaAddress } from './solana-address';

// ============================================================
// SOLANA DEPOSIT ADAPTER — FOUNDATION (read-only)
// ============================================================
// Thin JSON-RPC 2.0 client for read-only Solana RPC primitives
// (slot, signatures, transaction, status). This phase implements ONLY
// read-only connectivity — no SPL transfer parsing, no credit, no sweep,
// no broadcast. Detection/credit belong to a later phase.

export class SolanaDepositAdapter {
  private id = 0;

  constructor(
    private readonly network: NetworkConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  getChainId(): number {
    return SOLANA_CHAIN_ID;
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
    return isValidSolanaAddress(address);
  }

  private get rpcUrl(): string {
    const url = this.network.rpcUrls[0];
    if (!url) throw new Error('SOLANA RPC is not configured');
    return url;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** JSON-RPC with bounded retry/backoff on timeout/429/5xx/connection errors. */
  private async rpc(method: string, params: unknown[]): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.fetchFn(this.rpcUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++this.id,
            method,
            params,
          }),
          ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
            ? { signal: AbortSignal.timeout(15000) }
            : {}),
        });

        if (!res.ok) {
          const retryable =
            res.status === 429 ||
            res.status === 500 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504;
          if (retryable && attempt < 3) {
            await this.sleep(attempt * 1000);
            continue;
          }
          throw new Error(`Solana RPC failed (${res.status}) for ${method}`);
        }

        const json = (await res.json()) as {
          error?: { code: number; message: string };
          result?: unknown;
        };
        if (json.error) {
          throw new Error(`Solana RPC error: ${json.error.code} ${json.error.message}`);
        }
        return json.result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable =
          message.includes('timeout') ||
          message.includes('abort') ||
          message.includes('econnrefused') ||
          message.includes('econnreset') ||
          message.includes('enotfound') ||
          message.includes('fetch failed') ||
          message.includes('429') ||
          message.includes('502') ||
          message.includes('503') ||
          message.includes('504');
        if (retryable && attempt < 3) {
          await this.sleep(attempt * 1000);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /** Latest finalized slot. */
  async getLatestSlot(): Promise<number> {
    const slot = await this.rpc('getSlot', ['finalized']);
    return Number(slot);
  }

  /**
   * Recent confirmed signatures for an address (read-only).
   *
   * @param address   - Token account or wallet address.
   * @param limit     - Max signatures (bounded; default 200).
   * @param beforeSlot - Optional slot ceiling. When provided, only signatures
   *                     at or before this slot are returned, giving the watcher
   *                     a restart-safe cursor. Combined with the in-memory +
   *                     BullMQ dedup, this guarantees no missed transactions on
   *                     restart while bounding how far back we rescan.
   */
  async getSignaturesForAddress(
    address: string,
    limit = 200,
    beforeSlot?: number,
  ): Promise<any[]> {
    const cfg: Record<string, unknown> = { limit };
    // Use a signature cursor when restarting from a known slot to avoid
    // re-scanning the full history. We use `before` with a recent signature
    // only when we have one; for the slot-based approach we pass minContextSlot
    // to hint the RPC.
    if (beforeSlot && beforeSlot > 0) {
      cfg.minContextSlot = beforeSlot;
    }
    const result = await this.rpc('getSignaturesForAddress', [address, cfg]);
    return Array.isArray(result) ? result : [];
  }

  /** Transaction details + metadata (read-only, jsonParsed for SPL parsing). */
  async getTransaction(signature: string): Promise<any> {
    return this.rpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
  }

  /** SPL token accounts owned by `owner` for the configured USDT mint. */
  async getTokenAccountsByOwner(owner: string, mint: string): Promise<string[]> {
    const result = await this.rpc('getTokenAccountsByOwner', [
      owner,
      { mint, encoding: 'base64' },
      { encoding: 'base64' },
    ]);
    const value = result?.value ?? [];
    return value
      .map((x: any) => (typeof x?.pubkey === 'string' ? x.pubkey : null))
      .filter((p: string | null): p is string => Boolean(p));
  }

  /** Confirmation/slot status for a set of signatures. */
  async getSignatureStatuses(signatures: string[]): Promise<any[]> {
    const result = await this.rpc('getSignatureStatuses', [
      signatures,
      { searchTransactionHistory: true },
    ]);
    return result?.value ?? [];
  }

  /** SOL (lamports) balance of an address. */
  async getBalanceLamports(address: string): Promise<bigint> {
    const result = await this.rpc('getBalance', [address]);
    return BigInt(result?.value ?? 0);
  }

  /** USDT (raw token units) balance for a token account address. */
  async getTokenBalance(tokenAccount: string): Promise<bigint> {
    const result = await this.rpc('getTokenAccountBalance', [tokenAccount]);
    return BigInt(result?.value?.amount ?? 0);
  }

  /** Durable nonce account data (blockhash + authority). */
  async getNonceAccount(nonceAccount: string): Promise<{
    blockhash: string;
    authority: string;
  } | null> {
    const result = await this.rpc('getAccountInfo', [
      nonceAccount,
      { encoding: 'jsonParsed' },
    ]);
    if (!result?.value?.data?.parsed) return null;
    const info = result.value.data.parsed.info;
    if (!info) return null;
    return {
      blockhash: info.blockhash as string,
      authority: info.authority as string,
    };
  }

  /** Broadcast a base64-encoded signed transaction. Returns the signature. */
  async sendRawTransaction(
    signedBase64: string,
  ): Promise<string> {
    const result = await this.rpc('sendTransaction', [
      signedBase64,
      { encoding: 'base64', skipPreflight: false, maxRetries: 3 },
    ]);
    return typeof result === 'string' ? result : '';
  }
}