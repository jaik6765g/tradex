import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NetworkRegistryService } from '../networks/network-registry.service';

export interface RegisteredToken {
  symbol: string;
  chainId: number;
  decimals: number;
  contract: string;
  /** 1 asset unit = tdxRate TDX. */
  tdxRate: number;
}

@Injectable()
export class TokenRegistryService {
  constructor(
    private readonly configService: ConfigService,
    private readonly networkRegistry: NetworkRegistryService,
  ) {}

  getTdxRate(): number {
    const raw = this.configService.get<string>('TDX_PER_USDT');
    const rate = raw ? Number(raw) : 100;
    return Number.isFinite(rate) && rate > 0 ? rate : 100;
  }

  getToken(asset: string, chainId: number): RegisteredToken {
    const symbol = (asset ?? '').toUpperCase();

    if (symbol !== 'USDT') {
      throw new BadRequestException(`Unsupported asset: ${asset}`);
    }

    // Single source of truth: resolve USDT config from the network registry.
    const network = this.networkRegistry.getNetworkByChainId(chainId);

    if (!network || network.chainId == null) {
      throw new BadRequestException(`Unsupported chain: ${chainId}`);
    }
    if (network.protocol !== 'EVM' && network.protocol !== 'TRON' && network.protocol !== 'SOLANA') {
      throw new BadRequestException(`Unsupported chain: ${chainId}`);
    }

    if (!network.usdtContract) {
      throw new BadRequestException('USDT is not configured for this chain');
    }

    return {
      symbol,
      chainId: network.chainId,
      decimals: network.usdtDecimals,
      contract: network.usdtContract,
      tdxRate: this.getTdxRate(),
    };
  }

  isSupported(asset: string, chainId: number): boolean {
    try {
      this.getToken(asset, chainId);
      return true;
    } catch {
      return false;
    }
  }
}
