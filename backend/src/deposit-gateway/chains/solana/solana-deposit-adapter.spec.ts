import { SolanaDepositAdapter } from './solana-deposit-adapter';
import type { NetworkConfig } from '../../networks/network-registry.service';

function network(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    id: 'solana',
    name: 'Solana',
    protocol: 'SOLANA',
    chainId: 501,
    nativeSymbol: 'SOL',
    usdtContract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    usdtDecimals: 6,
    confirmations: 32,
    explorer: 'https://solscan.io',
    rpcUrls: ['https://api.mainnet-beta.solana.com'],
    configured: false,
    depositEnabled: false,
    watcherEnabled: false,
    sweepEnabled: false,
    treasuryAddress: '',
    status: 'DISABLED',
    ...overrides,
  };
}

function rpcFetch(
  handler: (method: string, params: unknown[]) => any,
): typeof fetch {
  return (async (_input: any, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}');
    let result;
    let error;
    try {
      result = handler(body.method, body.params ?? []);
    } catch (e) {
      error = { code: -32603, message: (e as Error).message };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: body.id, result, error }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('SolanaDepositAdapter (read-only foundation)', () => {
  it('exposes Solana network/token facts', () => {
    const a = new SolanaDepositAdapter(network());
    expect(a.getChainId()).toBe(501);
    expect(a.getTokenAddress()).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(a.getTokenDecimals()).toBe(6);
    expect(a.getRequiredConfirmations()).toBe(32);
  });

  it('reads the latest finalized slot', async () => {
    const a = new SolanaDepositAdapter(network(), rpcFetch((m) => (m === 'getSlot' ? 285000000 : undefined)));
    await expect(a.getLatestSlot()).resolves.toBe(285000000);
  });

  it('returns signatures for an address', async () => {
    const a = new SolanaDepositAdapter(
      network(),
      rpcFetch((m) => (m === 'getSignaturesForAddress' ? [{ signature: 'sig1' }] : undefined)),
    );
    const sigs = await a.getSignaturesForAddress('B9sVeu4rJU12oUrUtzjc6BSNuEXdfvurZkdcaTVkP2LY');
    expect(sigs).toEqual([{ signature: 'sig1' }]);
  });

  it('returns signature statuses value array', async () => {
    const a = new SolanaDepositAdapter(
      network(),
      rpcFetch((m) => (m === 'getSignatureStatuses' ? { value: [{ slot: 10, confirmations: 5 }] } : undefined)),
    );
    const statuses = await a.getSignatureStatuses(['sig']);
    expect(statuses).toEqual([{ slot: 10, confirmations: 5 }]);
  });

  it('propagates Solana RPC errors as observable failures', async () => {
    const a = new SolanaDepositAdapter(network(), rpcFetch(() => { throw new Error('slot not available'); }));
    await expect(a.getLatestSlot()).rejects.toThrow(/slot not available/);
  });

  it('throws when RPC is not configured', async () => {
    const a = new SolanaDepositAdapter(network({ rpcUrls: [] }));
    await expect(a.getLatestSlot()).rejects.toThrow(/not configured/);
  });
});