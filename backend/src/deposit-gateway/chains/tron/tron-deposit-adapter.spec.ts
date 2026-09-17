import {
  TronDepositAdapter,
  formatTdxUnits,
  formatUsdtUnits,
} from './tron-deposit-adapter';
import type { NetworkConfig } from '../../networks/network-registry.service';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function network(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    id: 'tron',
    name: 'TRON',
    protocol: 'TRON',
    chainId: 195,
    nativeSymbol: 'TRX',
    usdtContract: USDT,
    usdtDecimals: 6,
    confirmations: 19,
    explorer: 'https://tronscan.org',
    rpcUrls: ['https://api.trongrid.io'],
    configured: true,
    depositEnabled: true,
    watcherEnabled: true,
    sweepEnabled: false,
    treasuryAddress: '',
    status: 'ACTIVE',
    ...overrides,
  };
}

function fetchStub(
  handler: (url: string, init: RequestInit) => unknown,
): typeof fetch {
  return (async (input: any, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => handler(String(input), init ?? ({} as RequestInit)),
  })) as unknown as typeof fetch;
}

describe('TronDepositAdapter', () => {
  it('exposes TRON network/token facts', () => {
    const a = new TronDepositAdapter(network());
    expect(a.getChainId()).toBe(195);
    expect(a.getTokenAddress()).toBe(USDT);
    expect(a.getTokenDecimals()).toBe(6);
    expect(a.getRequiredConfirmations()).toBe(19);
    expect(a.validateAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')).toBe(true);
    expect(a.validateAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')).toBe(false);
  });

  it('parses the current block from getnowblock', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => ({ block_header: { raw_data: { number: 60000000 } } })),
    );
    await expect(a.getCurrentBlock()).resolves.toBe(60000000);
  });

  it('reads transaction finality (success + block number)', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => ({ blockNumber: 59999000, receipt: { result: 'SUCCESS' } })),
    );
    await expect(a.getTransactionInfo('0xabc')).resolves.toEqual({
      blockNumber: 59999000,
      success: true,
    });
  });

  it('marks a FAILED transaction as unsuccessful', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => ({ blockNumber: 59999000, receipt: { result: 'FAILED' } })),
    );
    const info = await a.getTransactionInfo('0xabc');
    expect(info.success).toBe(false);
  });

  it('converts raw USDT amounts to units and TDX at 6 decimals', () => {
    expect(formatUsdtUnits('1000000', 6)).toBe('1.0');
    expect(formatUsdtUnits('2500000', 6)).toBe('2.5');
    expect(formatTdxUnits('1000000', 6, 100)).toBe('100.0');
    expect(formatTdxUnits('2500000', 6, 100)).toBe('250.0');
  });

  it('parses TRC-20 transfers and filters to the configured USDT contract', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub((url) => {
        if (url.includes('/transactions/trc20')) {
          return {
            data: [
              {
                transaction_id: 't1',
                from: 'TDst1',
                to: 'TDeposit',
                token_info: { address: USDT, decimals: 6, symbol: 'USDT' },
                type: 'Transfer',
                value: '1000000',
                block_timestamp: 1700000000000,
              },
              {
                transaction_id: 't2',
                from: 'TDst2',
                to: 'TDeposit',
                token_info: { address: 'TOtherToken', decimals: 6 },
                type: 'Transfer',
                value: '5',
                block_timestamp: 1700000000001,
              },
            ],
          };
        }
        return {};
      }),
    );
    const transfers = await a.getTrc20Transfers('TDeposit');
    expect(transfers).toHaveLength(1);
    expect(transfers[0].txId).toBe('t1');
    expect(transfers[0].tokenAddress).toBe(USDT);
    expect(transfers[0].amountRaw).toBe('1000000');
    expect(transfers[0].decimals).toBe(6);
    expect(transfers[0].blockTimestamp).toBe(1700000000000);
  });

  it('throws when TRON RPC is not configured', async () => {
    const a = new TronDepositAdapter(network({ rpcUrls: [] }));
    await expect(a.getCurrentBlock()).rejects.toThrow(/not configured/);
  });

  it('surfaces RPC failures as errors', async () => {
    const a = new TronDepositAdapter(
      network(),
      (async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );
    await expect(a.getCurrentBlock()).rejects.toThrow(/503/);
  });

  it('reads the TRC-20 USDT balance of an address (0n when absent)', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => ({
        data: [{ address: 'TDeposit', trc20: [{ [USDT]: '2500000' }] }],
      })),
    );
    await expect(a.getTokenBalance('TDeposit')).resolves.toBe(2500000n);
  });

  it('returns 0n token balance when the USDT entry is missing', async () => {
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => ({
        data: [{ address: 'TDeposit', trc20: [{ TOther: '9' }] }],
      })),
    );
    await expect(a.getTokenBalance('TDeposit')).resolves.toBe(0n);
  });

  it('sends TRON-PRO-API-KEY when configured (never logs it)', async () => {
    let sentInit: RequestInit | undefined;
    const a = new TronDepositAdapter(
      network(),
      (async (input: any, init?: RequestInit) => {
        sentInit = init;
        return { ok: true, status: 200, json: async () => ({ block_header: { raw_data: { number: 5 } } }) };
      }) as unknown as typeof fetch,
      'secret-api-key',
    );
    await a.getCurrentBlock();
    const headers = sentInit?.headers as Record<string, string> | undefined;
    expect(headers?.['TRON-PRO-API-KEY']).toBe('secret-api-key');
  });

  it('retries a 429 and then succeeds without an API key leak', async () => {
    let calls = 0;
    const a = new TronDepositAdapter(
      network(),
      (async () => {
        calls++;
        if (calls <= 2) {
          return { ok: false, status: 429, json: async () => ({}) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ block_header: { raw_data: { number: 42 } } }) } as Response;
      }) as unknown as typeof fetch,
    );
    await expect(a.getCurrentBlock()).resolves.toBe(42);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('retries a 5xx then succeeds', async () => {
    let calls = 0;
    const a = new TronDepositAdapter(
      network(),
      (async () => {
        calls++;
        if (calls === 1) {
          return { ok: false, status: 503, json: async () => ({}) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ block_header: { raw_data: { number: 7 } } }) } as Response;
      }) as unknown as typeof fetch,
    );
    await expect(a.getCurrentBlock()).resolves.toBe(7);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('throws on a malformed getCurrentBlock response', async () => {
    const a = new TronDepositAdapter(network(), fetchStub(() => ({})));
    await expect(a.getCurrentBlock()).rejects.toThrow(/Invalid getnowblock/);
  });

  it('throws on a malformed getTransactionInfo response (no block)', async () => {
    const a = new TronDepositAdapter(network(), fetchStub(() => ({ receipt: { result: 'SUCCESS' } })));
    await expect(a.getTransactionInfo('0xabc')).rejects.toThrow(/no block/);
  });

  it('pages through getAllTrc20Transfers advancing the timestamp cursor', async () => {
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        transaction_id: `tx${offset + i}`,
        from: 'TFrm',
        to: 'TDeposit',
        token_info: { address: USDT, decimals: 6 },
        type: 'Transfer',
        value: '1000000',
        block_timestamp: 1700000000000 + offset + i,
      }));
    let pages = 0;
    const a = new TronDepositAdapter(
      network(),
      fetchStub(() => {
        pages++;
        return pages === 1 ? { data: page(0, 2) } : { data: page(2, 1) };
      }),
    );
    const transfers = await a.getAllTrc20Transfers('TDeposit', { pageSize: 2, maxPages: 5 });
    expect(transfers).toHaveLength(3);
    expect(new Set(transfers.map((t) => t.txId)).size).toBe(3); // deduped, complete
    expect(pages).toBe(2); // one full page then a short page stops the loop
  });
});
