import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

type RpcOperation<T> = (
  provider: ethers.JsonRpcProvider,
) => Promise<T>;

@Injectable()
export class BscRpcService implements OnModuleInit {
  private readonly logger = new Logger(BscRpcService.name);

  private readonly providers: ethers.JsonRpcProvider[] = [];
  private activeProviderIndex = 0;

  private readonly expectedChainId: number;
  private readonly requiredConfirmations: number;
  private readonly usdtAddress: string;
  private readonly vaultAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.expectedChainId =
      Number(this.configService.get<string>('BSC_CHAIN_ID')) || 56;
    this.requiredConfirmations =
      Number(this.configService.get<string>('BSC_REQUIRED_CONFIRMATIONS')) || 15;
    this.usdtAddress =
      this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || '';
    this.vaultAddress =
      this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() || '';
  }

  onModuleInit(): void {
    const primaryRpc =
      this.configService.get<string>('BSC_RPC_URL')?.trim() || '';
    const fallbackRpc =
      this.configService.get<string>('BSC_RPC_URL_FALLBACK')?.trim() || '';
    const fallback2Rpc =
      this.configService
        .get<string>('BSC_RPC_URL_FALLBACK_2')
        ?.trim() || '';

    if (!primaryRpc) {
      this.logger.warn(
        'BSC_RPC_URL is not configured — deposit verification may fail',
      );
    }

    const rpcUrls = [primaryRpc, fallbackRpc, fallback2Rpc].filter(
      Boolean,
    );

    for (const url of rpcUrls) {
      this.providers.push(
        new ethers.JsonRpcProvider(url, this.expectedChainId, {
          staticNetwork: true,
        }),
      );
    }

    if (this.providers.length === 0) {
      this.logger.error('No BSC RPC providers configured');
      return;
    }

    this.logger.log(
      `BSC RPC service initialized with ${this.providers.length} provider(s) (primary + ${this.providers.length - 1} fallback(s))`,
    );
  }

  getExpectedChainId(): number {
    return this.expectedChainId;
  }

  getRequiredConfirmations(): number {
    return this.requiredConfirmations;
  }

  getUsdtAddress(): string {
    return this.usdtAddress;
  }

  getVaultAddress(): string {
    return this.vaultAddress;
  }

  getActiveProvider(): ethers.JsonRpcProvider {
    return this.providers[this.activeProviderIndex];
  }

  getAllProviders(): ethers.JsonRpcProvider[] {
    return [...this.providers];
  }

  switchProvider(): void {
    if (this.providers.length <= 1) {
      return;
    }
    this.activeProviderIndex =
      (this.activeProviderIndex + 1) % this.providers.length;
    this.logger.warn(
      `🔄 Active BSC RPC provider switched to #${this.activeProviderIndex + 1}`,
    );
  }

  private isRpcError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('name_not_resolved') ||
      message.includes('dns') ||
      message.includes('network error') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504') ||
      message.includes('403') ||
      message.includes('rate limit') ||
      message.includes('limit exceeded') ||
      message.includes('too many requests') ||
      message.includes('socket hang up') ||
      message.includes('fetch failed') ||
      message.includes('request timed out') ||
      message.includes('unexpected eof') ||
      message.includes('socket') ||
      message.includes('disconnected')
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown RPC error';
    }
  }

  /**
   * Execute an RPC operation with automatic failover across all
   * configured providers (primary -> fallback -> fallback_2).
   *
   * On timeout / DNS / network / 429 / 5xx / unavailable errors, the
   * next provider is tried. Other errors (e.g. tx reverted, null
   * result) propagate immediately as they are not RPC-level failures.
   *
   * The last provider that succeeded becomes the new active provider,
   * so subsequent calls start from a known-good endpoint.
   */
  async withFailover<T>(
    operation: RpcOperation<T>,
    options: { maxAttempts?: number; label?: string } = {},
  ): Promise<T> {
    const maxAttempts =
      options.maxAttempts ?? Math.max(this.providers.length, 1);

    if (this.providers.length === 0) {
      throw new Error('BSC RPC service: no providers configured');
    }

    let lastError: unknown;
    let attempts = 0;

    for (let i = 0; i < this.providers.length && attempts < maxAttempts; i++) {
      const providerIndex =
        (this.activeProviderIndex + i) % this.providers.length;
      const provider = this.providers[providerIndex];

      try {
        const result = await operation(provider);
        // Remember the working provider for the next call.
        this.activeProviderIndex = providerIndex;
        return result;
      } catch (error) {
        lastError = error;

        if (this.isRpcError(error)) {
          attempts++;
          this.logger.warn(
            `BSC RPC ${options.label ?? 'call'} failed on provider #${providerIndex + 1}: ${this.getErrorMessage(error)}. Trying next provider...`,
          );
          continue;
        }

        // Non-RPC-level failure (e.g. reverted tx, not found) —
        // propagate immediately.
        throw error;
      }
    }

    throw lastError;
  }
}
