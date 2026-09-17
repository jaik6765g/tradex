import { DepositSweepService } from './deposit-sweep.service';
import { DepositSweepStatus } from './deposit-sweep.entity';
import { DepositStatus } from '../../deposits/deposit.entity';
import {
  POLYGON_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
} from '../config/networks.config';
import { keccak256 } from 'ethers';

const POLYGON_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const ARBITRUM_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const POLY_ADDR = '0xaAdDaaa57e6bB4Db7B3f4A4f4e1c7e1C0D3f3b3a';
const TREASURY = '0x2222222222222222222222222222222222222222';
const SIGNED_RAW = '0x' + 'ab'.repeat(80);
// Deterministic EVM tx hash = keccak256(signed raw tx) — exactly what the
// service computes and persists BEFORE broadcasting.
const TX = keccak256(SIGNED_RAW);

/**
 * Harness for the GAS_REQUIRED recovery lifecycle. Mirrors the real
 * repository/queue/adapter surface used by DepositSweepService.
 */
function makeService(opts: {
  sweep?: any;
  chainId?: number;
  nativeBalance?: bigint;
  tokenBalance?: bigint;
  gasPrice?: bigint;
  treasury?: string;
  queueJob?: any; // what sweepQueue.getJob(jobId) returns
  receipt?: any; // what adapter.getTransactionReceipt returns
  depositRows?: any[];
} = {}) {
  const chainId = opts.chainId ?? POLYGON_CHAIN_ID;
  const usdt = chainId === POLYGON_CHAIN_ID ? POLYGON_USDT : ARBITRUM_USDT;
  const treasury = opts.treasury ?? TREASURY;
  const sweep = opts.sweep ?? {
    id: 'sw-gas', depositId: 'd1', chainId,
    status: DepositSweepStatus.GAS_REQUIRED, destinationAddress: treasury,
    tokenAddress: usdt, amount: '10000000', sweepTxHash: null, signedTxRaw: null,
    failureReason: 'Insufficient native balance 0 < 5000000000000',
  };
  const sweeps: any[] = [sweep];

  const sweepRepo: any = {
    findOne: jest.fn(async (q: any) => {
      if (q.where.depositId) {
        return sweeps.find((s) => s.depositId === q.where.depositId) ?? null;
      }
      if (q.where.id) return sweeps.find((s) => s.id === q.where.id) ?? null;
      return null;
    }),
    find: jest.fn(async () =>
      sweeps.filter((s) => s.status === DepositSweepStatus.GAS_REQUIRED),
    ),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (s: any) => s),
  };
  const depositRow = {
    id: 'd1', chainId, depositAddress: POLY_ADDR,
    status: DepositStatus.COMPLETED, amount: '10000000', usdtAmount: '10',
  };
  const depositRepo: any = {
    findOne: jest.fn(async () => depositRow),
    find: jest.fn(async () => opts.depositRows ?? [depositRow]),
  };
  const addressService: any = {
    findByAddressAndChainId: jest.fn(async () => ({ id: 'a1', derivationIndex: 3 })),
    isCompromised: jest.fn(async () => false),
    isDevelopment: () => false,
  };
  const adapter: any = {
    getChainId: () => chainId,
    getGasPrice: jest.fn(async () => opts.gasPrice ?? 30n),
    getNativeBalance: jest.fn(async () => opts.nativeBalance ?? 10n ** 18n),
    getTokenBalance: jest.fn(async () => opts.tokenBalance ?? 100_000_000n),
    getNonce: jest.fn(async () => 7),
    sendRawTransaction: jest.fn(async () => TX),
    getTransactionReceipt: jest.fn(async () => opts.receipt ?? null),
  };
  const chainRegistry: any = { getAdapter: () => adapter };
  const networkRegistry: any = {
    getNetworkByChainId: () => ({
      id: chainId === POLYGON_CHAIN_ID ? 'polygon' : 'arbitrum',
      protocol: 'EVM', chainId, usdtContract: usdt, treasuryAddress: treasury,
    }),
  };
  const signer: any = {
    canSign: () => true,
    signTokenTransfer: jest.fn(async () => ({ signedTransaction: SIGNED_RAW })),
  };
  const gasFunding: any = { fundIfNeeded: jest.fn(async () => ({ funded: false })) };
  const sweepQueue: any = {
    add: jest.fn(async () => ({})),
    getJob: jest.fn(async () => opts.queueJob ?? null),
  };
  const confirmQueue: any = { add: jest.fn(async () => ({})) };
  const configService: any = {
    get: (key: string) => {
      if (key === 'DEPOSIT_SWEEP_ENABLED') return 'true';
      if (key === 'DEPOSIT_SWEEP_GAS_LIMIT') return '100000';
      return undefined;
    },
  };
  const dataSource: any = { query: jest.fn(async () => ({ rows: [] })) };
  const svc = new DepositSweepService(
    sweepRepo, depositRepo, dataSource, addressService, chainRegistry,
    { getToken: () => ({ contract: usdt }) } as any, networkRegistry,
    {} as any, {} as any, configService, signer, gasFunding,
    sweepQueue, confirmQueue,
  );
  return { svc, sweep, sweeps, sweepRepo, adapter, signer, gasFunding, sweepQueue, confirmQueue };
}

describe('EVM sweep — GAS_REQUIRED recovery lifecycle', () => {
  it('PENDING + insufficient gas → GAS_REQUIRED + funding hook + NO broadcast', async () => {
    const pending = {
      id: 'sw-gas', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
      status: DepositSweepStatus.PENDING, destinationAddress: TREASURY,
      tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: null,
      signedTxRaw: null,
    };
    const { svc, sweep, signer, adapter, gasFunding } = makeService({
      sweep: pending, nativeBalance: 0n,
    });
    await expect(svc.executeSweep('sw-gas')).rejects.toThrow(/Insufficient gas/i);
    expect(sweep.status).toBe(DepositSweepStatus.GAS_REQUIRED);
    expect(gasFunding.fundIfNeeded).toHaveBeenCalled();
    expect(signer.signTokenTransfer).not.toHaveBeenCalled();
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('GAS_REQUIRED + still insufficient gas → remains GAS_REQUIRED, no sign/broadcast', async () => {
    const { svc, sweep, signer, adapter } = makeService({ nativeBalance: 0n });
    await expect(svc.executeSweep('sw-gas')).rejects.toThrow(/Insufficient gas/i);
    expect(sweep.status).toBe(DepositSweepStatus.GAS_REQUIRED);
    expect(sweep.sweepTxHash).toBeNull();
    expect(signer.signTokenTransfer).not.toHaveBeenCalled();
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('GAS_REQUIRED + gas becomes sufficient → enters safe execution path → SUBMITTED', async () => {
    const { svc, sweep, signer, adapter, confirmQueue } = makeService({
      nativeBalance: 400_000_000_000_000n, // matches the live funded amount
    });
    await svc.executeSweep('sw-gas');
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    // Deterministic identity preserved: hash = keccak256(signed raw tx).
    expect(sweep.sweepTxHash).toBe(TX);
    expect(sweep.signedTxRaw).toBe(SIGNED_RAW);
    expect(signer.signTokenTransfer).toHaveBeenCalledTimes(1);
    expect(adapter.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(confirmQueue.add).toHaveBeenCalledWith(
      'confirm-sweep',
      { sweepId: 'sw-gas' },
      expect.anything(),
    );
  });

  it('GAS_REQUIRED recovery re-enters through the SAME hardened gas pre-check (still parks when gas is 0)', async () => {
    const { svc, sweep, gasFunding, adapter } = makeService({ nativeBalance: 0n });
    await expect(svc.executeSweep('sw-gas')).rejects.toThrow(/Insufficient gas/i);
    expect(sweep.status).toBe(DepositSweepStatus.GAS_REQUIRED);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
    expect(gasFunding.fundIfNeeded).toHaveBeenCalled();
  });

  it('scheduler discovers GAS_REQUIRED sweeps and re-enqueues with deterministic jobId', async () => {
    const { svc, sweepQueue } = makeService({ queueJob: null });
    await svc.scheduleDueSweeps();
    expect(sweepQueue.add).toHaveBeenCalledWith(
      'process-sweep',
      { sweepId: 'sw-gas' },
      expect.objectContaining({ jobId: 'sweep-sw-gas' }),
    );
  });

  it('recovery after the original BullMQ job was consumed (dead failed job removed, re-enqueued)', async () => {
    const deadJob = {
      isActive: jest.fn(async () => false),
      isWaiting: jest.fn(async () => false),
      isDelayed: jest.fn(async () => false),
      remove: jest.fn(async () => undefined),
    };
    const { svc, sweepQueue } = makeService({ queueJob: deadJob });
    await svc.scheduleDueSweeps();
    expect(deadJob.remove).toHaveBeenCalled();
    expect(sweepQueue.add).toHaveBeenCalledWith(
      'process-sweep',
      { sweepId: 'sw-gas' },
      expect.objectContaining({ jobId: 'sweep-sw-gas' }),
    );
  });

  it('repeated scheduler cycles never create duplicate sweeps or queue jobs', async () => {
    const { svc, sweepRepo, sweepQueue } = makeService({ queueJob: null });
    await svc.scheduleDueSweeps();
    await svc.scheduleDueSweeps();
    expect(sweepRepo.create).not.toHaveBeenCalled();
    const jobIds = sweepQueue.add.mock.calls.map((c: any[]) => c[2]?.jobId);
    expect(jobIds).toEqual(['sweep-sw-gas', 'sweep-sw-gas']);
  });

  it('a live queue job for the sweep is NOT duplicated by the scheduler', async () => {
    const liveJob = {
      isActive: jest.fn(async () => true),
      isWaiting: jest.fn(async () => false),
      isDelayed: jest.fn(async () => false),
      remove: jest.fn(async () => undefined),
    };
    const { svc, sweepQueue } = makeService({ queueJob: liveJob });
    await svc.scheduleDueSweeps();
    expect(sweepQueue.add).not.toHaveBeenCalled();
    expect(liveJob.remove).not.toHaveBeenCalled();
  });

  it('existing BROADCASTING recovery remains unchanged (no second sign, no new tx)', async () => {
    const broadcasting = {
      id: 'sw-gas', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
      status: DepositSweepStatus.BROADCASTING, destinationAddress: TREASURY,
      tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      signedTxRaw: SIGNED_RAW,
    };
    const { svc, sweep, signer } = makeService({
      sweep: broadcasting, nativeBalance: 400_000_000_000_000n,
    });
    await svc.executeSweep('sw-gas');
    // Mid-flight recovery — never a fresh sign of a NEW transaction.
    expect(signer.signTokenTransfer).not.toHaveBeenCalled();
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(sweep.sweepTxHash).toBe(TX);
  });

  it('existing SUBMITTED confirmation remains unchanged', async () => {
    const submitted = {
      id: 'sw-gas', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
      status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
      tokenAddress: POLYGON_USDT, amount: '10000000',
      sweepTxHash: TX, signedTxRaw: SIGNED_RAW,
    };
    const receipt = { status: 1, blockNumber: 123 };
    const { svc, sweep, signer, confirmQueue } = makeService({
      sweep: submitted, receipt,
    });
    await svc.executeSweep('sw-gas');
    expect(sweep.status).toBe(DepositSweepStatus.COMPLETED);
    expect(signer.signTokenTransfer).not.toHaveBeenCalled();
    expect(confirmQueue.add).not.toHaveBeenCalled();
  });

  it('GAS_REQUIRED recovery with NO source token balance → MANUAL_REVIEW preserved', async () => {
    const { svc, sweep, adapter } = makeService({
      nativeBalance: 400_000_000_000_000n, tokenBalance: 0n,
    });
    await svc.executeSweep('sw-gas');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/Insufficient source USDT/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('treasury validation preserved on the GAS_REQUIRED recovery path', async () => {
    const { svc, sweep, adapter } = makeService({
      nativeBalance: 400_000_000_000_000n,
      treasury: POLY_ADDR, // treasury == source → invalid
    });
    await svc.executeSweep('sw-gas');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('cross-network isolation preserved: Arbitrum recovery uses Arbitrum USDT/chain', async () => {
    const arbSweep = {
      id: 'sw-gas', depositId: 'd1', chainId: ARBITRUM_CHAIN_ID,
      status: DepositSweepStatus.GAS_REQUIRED,
      destinationAddress: TREASURY, tokenAddress: ARBITRUM_USDT,
      amount: '10000000', sweepTxHash: null, signedTxRaw: null,
    };
    const { svc, sweep, signer } = makeService({
      sweep: arbSweep, chainId: ARBITRUM_CHAIN_ID,
      nativeBalance: 400_000_000_000_000n,
    });
    await svc.executeSweep('sw-gas');
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    const call = signer.signTokenTransfer.mock.calls[0][0];
    expect(call.tokenAddress).toBe(ARBITRUM_USDT);
    expect(call.chainId).toBe(ARBITRUM_CHAIN_ID);
  });
});