import { Injectable } from '@nestjs/common';

import { type GasFundingProvider } from './gas-funding-provider.interface';

/**
 * Default gas-funding provider: does nothing. Sweeps that require gas will be
 * marked GAS_REQUIRED and wait for a configured funding policy (treasury gas
 * funding, custody provider, or an internal gas wallet).
 */
@Injectable()
export class NoopGasFundingProvider implements GasFundingProvider {
  readonly name = 'noop';

  async fundIfNeeded(): Promise<{ funded: boolean }> {
    return { funded: false };
  }
}
