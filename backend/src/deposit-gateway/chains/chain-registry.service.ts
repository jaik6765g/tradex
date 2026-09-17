import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import {
  type ChainAdapter,
  CHAIN_ADAPTERS,
} from './chain-adapter.interface';

@Injectable()
export class ChainRegistryService {
  constructor(
    @Inject(CHAIN_ADAPTERS)
    private readonly adapters: ChainAdapter[],
  ) {}

  getAdapter(chainId: number): ChainAdapter {
    const adapter = this.adapters.find((a) => a.getChainId() === chainId);

    if (!adapter) {
      throw new BadRequestException(`Unsupported chain: ${chainId}`);
    }

    return adapter;
  }

  listChains(): Array<{ chainId: number; nativeSymbol: string }> {
    return this.adapters.map((a) => ({
      chainId: a.getChainId(),
      nativeSymbol: a.getNativeSymbol(),
    }));
  }
}
