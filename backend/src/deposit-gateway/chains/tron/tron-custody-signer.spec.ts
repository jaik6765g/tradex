import { TronCustodySigner } from './tron-custody-signer';
import type { ConfigService } from '@nestjs/config';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('TronCustodySigner', () => {
  it('is configured/can sign only when a TRON mnemonic is available', () => {
    const yes = new TronCustodySigner(
      config({ TRON_DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const fallback = new TronCustodySigner(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    const none = new TronCustodySigner(config({}));

    expect(yes.canSign()).toBe(true);
    expect(fallback.canSign()).toBe(true);
    expect(none.canSign()).toBe(false);
  });

  it('refuses to sign without a configured mnemonic (no network/tronweb needed)', async () => {
    const signer = new TronCustodySigner(config({}));
    await expect(
      signer.signTrc20Transfer({
        rpcUrl: 'https://api.trongrid.io',
        tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        from: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
        to: 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK',
        amountSun: '1000000',
        derivationIndex: 0,
        feeLimitSun: '20000000',
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('rejects invalid derivation indices before attempting to sign', async () => {
    const signer = new TronCustodySigner(
      config({ DEPOSIT_WALLET_MNEMONIC: MNEMONIC }),
    );
    await expect(
      signer.signTrc20Transfer({
        rpcUrl: 'x',
        tokenAddress: 'x',
        from: 'x',
        to: 'x',
        amountSun: '1',
        derivationIndex: -1,
        feeLimitSun: '1',
      }),
    ).rejects.toThrow(/Invalid TRON derivation index/);
  });
});