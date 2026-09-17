import {
  computeEvmAccounting,
  EvmBalanceReconciliationService,
} from './evm-balance-reconciliation.service';
import { POLYGON_CHAIN_ID } from '../../config/networks.config';

describe('computeEvmAccounting (bigint-only, read-only)', () => {
  it('MATCHED when balance equals expected remaining', () => {
    const r = computeEvmAccounting({
      balanceRaw: 5_000_000n,
      confirmedDepositRaw: [10_000_000n],
      completedSweepRaw: [5_000_000n],
    });
    expect(r.status).toBe('MATCHED');
    expect(r.expectedRemainingRaw).toBe(5_000_000n);
    expect(r.residualRaw).toBe(0n);
  });

  it('RESIDUAL when on-chain balance exceeds expected', () => {
    const r = computeEvmAccounting({
      balanceRaw: 7_000_000n,
      confirmedDepositRaw: [10_000_000n],
      completedSweepRaw: [5_000_000n],
    });
    expect(r.status).toBe('RESIDUAL');
    expect(r.residualRaw).toBe(2_000_000n);
  });

  it('UNDER when on-chain balance is below expected', () => {
    const r = computeEvmAccounting({
      balanceRaw: 3_000_000n,
      confirmedDepositRaw: [10_000_000n],
      completedSweepRaw: [5_000_000n],
    });
    expect(r.status).toBe('UNDER');
    expect(r.residualRaw).toBe(-2_000_000n);
  });

  it('handles multiple deposits/sweeps with 6-decimal precision', () => {
    const r = computeEvmAccounting({
      balanceRaw: 15_500_000n,
      confirmedDepositRaw: [10_000_000n, 20_000_000n, 1_500_000n],
      completedSweepRaw: [10_000_000n, 6_000_000n],
    });
    expect(r.depositedRaw).toBe(31_500_000n);
    expect(r.sweptRaw).toBe(16_000_000n);
    expect(r.expectedRemainingRaw).toBe(15_500_000n);
    expect(r.status).toBe('MATCHED');
  });

  it('is read-only (never mutates its inputs)', () => {
    const input = {
      balanceRaw: 5_000_000n,
      confirmedDepositRaw: [10_000_000n],
      completedSweepRaw: [5_000_000n],
    };
    computeEvmAccounting(input);
    expect(input.balanceRaw).toBe(5_000_000n);
    expect(input.confirmedDepositRaw).toEqual([10_000_000n]);
    expect(input.completedSweepRaw).toEqual([5_000_000n]);
  });
});

describe('EvmBalanceReconciliationService', () => {
  function makeService(opts: {
    balances?: bigint[];
    deposits?: any[];
    sweeps?: any[];
    addresses?: any[];
    configured?: boolean;
  }) {
    const depositRepo = {
      find: jest.fn(async () => opts.deposits ?? []),
    } as any;
    const sweepRepo = {
      find: jest.fn(async () => opts.sweeps ?? []),
    } as any;
    const addressService = {
      findActiveByChain: jest.fn(async () => opts.addresses ?? []),
    } as any;
    const adapter: any = {
      getChainId: () => POLYGON_CHAIN_ID,
      getTokenBalance: jest.fn(async () => opts.balances?.[0] ?? 0n),
    };
    const chainRegistry = {
      getAdapter: jest.fn(() => adapter),
    } as any;
    const networkRegistry = {
      getNetworkByChainId: jest.fn(() => ({
        id: 'polygon',
        protocol: 'EVM',
        chainId: POLYGON_CHAIN_ID,
        usdtContract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        configured: opts.configured ?? true,
      })),
    } as any;
    const svc = new EvmBalanceReconciliationService(
      depositRepo,
      sweepRepo,
      addressService,
      chainRegistry,
      networkRegistry,
    );
    return { svc, adapter };
  }

  it('returns MATCHED rows for zero-balance addresses', async () => {
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [0n],
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('MATCHED');
    expect(rows[0].chainId).toBe(POLYGON_CHAIN_ID);
  });

  it('flags RESIDUAL when on-chain USDT exceeds accounting', async () => {
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [2_000_000n],
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows[0].status).toBe('RESIDUAL');
    expect(rows[0].residualRaw).toBe('2000000');
  });

  it('excludes pending/submitted sweeps from completed; reports separately', async () => {
    const dep = { id: 'd1', amount: '10000000', depositAddress: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', status: 'COMPLETED' };
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [10_000_000n],
      deposits: [dep],
      sweeps: [
        { depositId: 'd1', status: 'PENDING', amount: '10000000' },
        { depositId: 'd1', status: 'SUBMITTED', amount: '10000000' },
      ],
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows[0].sweptRaw).toBe('0');
    expect(rows[0].pendingSweepRaw).toBe('20000000');
    expect(rows[0].status).toBe('MATCHED');
  });

  it('excludes FAILED and MANUAL_REVIEW sweeps entirely', async () => {
    const dep = { id: 'd1', amount: '10000000', depositAddress: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', status: 'COMPLETED' };
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [10_000_000n],
      deposits: [dep],
      sweeps: [
        { depositId: 'd1', status: 'FAILED', amount: '10000000' },
        { depositId: 'd1', status: 'MANUAL_REVIEW', amount: '10000000' },
      ],
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows[0].sweptRaw).toBe('0');
    expect(rows[0].status).toBe('MATCHED');
  });

  it('counts only COMPLETED sweeps against expected remaining', async () => {
    const dep = { id: 'd1', amount: '10000000', depositAddress: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', status: 'COMPLETED' };
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [0n],
      deposits: [dep],
      sweeps: [{ depositId: 'd1', status: 'COMPLETED', amount: '10000000' }],
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows[0].sweptRaw).toBe('10000000');
    expect(rows[0].expectedRemainingRaw).toBe('0');
    expect(rows[0].status).toBe('MATCHED');
  });

  it('skips an address on RPC failure without mutating accounting', async () => {
    const { svc, adapter } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
    });
    adapter.getTokenBalance = jest.fn(async () => {
      throw new Error('RPC timeout');
    });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows).toEqual([]);
  });

  it('returns [] when the network is not configured', async () => {
    const { svc } = makeService({ configured: false });
    const rows = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(rows).toEqual([]);
  });

  it('is repeatable — same inputs produce the same result', async () => {
    const { svc } = makeService({
      addresses: [{ address: '0xAaDdAAA57e6Bb4dB7b3f4a4F4e1C7E1C0d3F3B3a', userId: 'u1' }],
      balances: [3_000_000n],
    });
    const a = await svc.reconcileChain(POLYGON_CHAIN_ID);
    const b = await svc.reconcileChain(POLYGON_CHAIN_ID);
    expect(a).toEqual(b);
  });
});