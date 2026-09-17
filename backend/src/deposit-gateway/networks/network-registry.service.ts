import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GENERIC_TREASURY_ENV_KEY,
  NETWORK_DEFINITIONS,
  SWEEP_ENABLED_ENV_KEY,
  type NetworkDefinition,
} from '../config/networks.config';

export type NetworkProtocol = 'EVM' | 'TRON' | 'SOLANA';
export type NetworkStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISABLED';

export interface NetworkConfig {
  id: string;
  name: string;
  protocol: NetworkProtocol;
  /** EVM chain id; null for non-EVM networks. */
  chainId: number | null;
  nativeSymbol: string;
  /** USDT contract (EVM/TRC-20) or mint (SPL). */
  usdtContract: string;
  usdtDecimals: number;
  confirmations: number;
  explorer: string;
  rpcUrls: string[];
  /** True only when adapter + watcher + sweep can actually run (EVM + RPC + token). */
  configured: boolean;
  depositEnabled: boolean;
  watcherEnabled: boolean;
  sweepEnabled: boolean;
  treasuryAddress: string;
  status: NetworkStatus;
}

/**
 * Resolves the static NETWORK_DEFINITIONS (networks.config.ts) against the
 * runtime environment. All public network facts come from the config file —
 * this class only combines them with env-provided RPC/treasury/opt-in values.
 */
@Injectable()
export class NetworkRegistryService {
  constructor(private readonly configService: ConfigService) {}

  listNetworks(): NetworkConfig[] {
    return NETWORK_DEFINITIONS.map((d) => this.resolve(d));
  }

  listEnabled(): NetworkConfig[] {
    return this.listNetworks().filter((n) => n.depositEnabled);
  }

  listEnabledEvm(): NetworkConfig[] {
    return this.listEnabled().filter((n) => n.protocol === 'EVM');
  }

  /** EVM networks with a usable adapter (RPC + USDT contract), for watcher + reconciliation. */
  listWatchable(): NetworkConfig[] {
    return this.listNetworks().filter(
      (n) => n.protocol === 'EVM' && n.watcherEnabled,
    );
  }

  getNetwork(id: string): NetworkConfig {
    const network = this.listNetworks().find((n) => n.id === id);
    if (!network) {
      throw new BadRequestException(`Unsupported network: ${id}`);
    }
    return network;
  }

  getNetworkByChainId(chainId: number): NetworkConfig | undefined {
    return this.listNetworks().find((n) => n.chainId === chainId);
  }

  getTreasury(id: string): string {
    const definition = NETWORK_DEFINITIONS.find((n) => n.id === id);
    const specific = definition?.envKeys.treasury
      ? this.env(definition.envKeys.treasury)
      : '';
    return specific || this.env(GENERIC_TREASURY_ENV_KEY);
  }

  private resolve(d: NetworkDefinition): NetworkConfig {
    const rpcUrls = d.envKeys.rpc.map((k) => this.env(k)).filter(Boolean);
    const usdtContract = this.env(d.envKeys.usdt ?? '') || d.usdtContract;
    const configured = rpcUrls.length > 0 && Boolean(usdtContract);

    const depositEnabled =
      configured &&
      (d.depositEnabledDefault ||
        this.env(d.envKeys.depositEnabled ?? '') === 'true');

    const globalSweep = this.env(SWEEP_ENABLED_ENV_KEY) === 'true';

    const status: NetworkStatus = configured
      ? depositEnabled
        ? 'ACTIVE'
        : 'MAINTENANCE'
      : 'DISABLED';

    return {
      id: d.id,
      name: d.name,
      protocol: d.protocol,
      chainId: d.chainId,
      nativeSymbol: d.nativeSymbol,
      usdtContract,
      usdtDecimals: this.numberOr(d.usdtDecimals, d.envKeys.decimals),
      confirmations: this.numberOr(d.requiredConfirmations, d.envKeys.confirmations),
      explorer: this.env(d.envKeys.explorer ?? '') || d.explorer,
      rpcUrls,
      configured,
      depositEnabled,
      watcherEnabled:
        configured &&
        this.flagOrDefault(d.envKeys.watcherEnabled, d.watcherEnabledDefault),
      sweepEnabled:
        configured &&
        globalSweep &&
        this.flagOrDefault(d.envKeys.sweepEnabled, d.sweepEnabledDefault),
      treasuryAddress: this.resolveTreasury(d),
      status,
    };
  }

  /**
   * Resolve an optional per-network boolean env override; falls back to the
   * network's declared default when the env key is not defined (additive —
   * EVM/TRON networks that declare no override keep their existing behavior).
   */
  private flagOrDefault(envKey: string | undefined, defaultValue: boolean): boolean {
    if (envKey) {
      return this.env(envKey) === 'true';
    }
    return defaultValue;
  }

  private resolveTreasury(d: NetworkDefinition): string {
    const specific = d.envKeys.treasury ? this.env(d.envKeys.treasury) : '';
    return specific || this.env(GENERIC_TREASURY_ENV_KEY);
  }

  private numberOr(defaultValue: number, envKey?: string): number {
    if (!envKey) return defaultValue;
    const raw = this.env(envKey);
    if (!raw) return defaultValue;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
  }

  private env(key: string): string {
    return this.configService.get<string>(key)?.trim() ?? '';
  }
}

