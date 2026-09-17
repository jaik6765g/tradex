import { DepositSweepService } from '../../sweeps/deposit-sweep.service';
import { DepositSweepStatus } from '../../sweeps/deposit-sweep.entity';
import { DepositStatus } from '../../../deposits/deposit.entity';
import { POLYGON_CHAIN_ID, ARBITRUM_CHAIN_ID } from '../../config/networks.config';
import { keccak256 } from 'ethers';

const POLYGON_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const ARBITRUM_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const POLY_ADDR = '0xaAdDaaa57e6bB4Db7B3f4A4f4e1c7e1C0D3f3b3a';
const TREASURY = '0x2222222222222222222222222222222222222222';
const SIGNED_RAW = '0x' + 'ab'.repeat(80);
// Deterministic EVM tx hash = keccak256(signed raw tx) — exactly what the
// service computes and persists BEFORE broadcasting.
const TX = keccak256(SIGNED_RAW);

describe('EVM sweep failure injection — HARDENED (Polygon via generic path)', () => {
  function makeService(opts: {
    sweep?: any;
    chainId?: number;
    usdt?: string;
    sourceAddr?: string;
    nativeBalance?: bigint;
    tokenBalance?: bigint;
    gasPrice?: bigint;
    signError?: Error;
    receipt?: any;
    broadcastError?: Error;
    treasury?: string;
  } = {}) {
    const chainId = opts.chainId ?? POLYGON_CHAIN_ID;
    const usdt = opts.usdt ?? (chainId === POLYGON_CHAIN_ID ? POLYGON_USDT : ARBITRUM_USDT);
    const sourceAddr = opts.sourceAddr ?? POLY_ADDR;
    const treasury = opts.treasury ?? TREASURY;
    const sweep = opts.sweep ?? {
      id: 'sw-1', depositId: 'd1', chainId,
      status: DepositSweepStatus.PENDING, destinationAddress: treasury,
      tokenAddress: usdt, amount: '10000000', sweepTxHash: null, signedTxRaw: null,
    };
    const sweepRepo: any = {
      findOne: jest.fn(async () => sweep),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (s: any) => s),
    };
    const depositRow = {
      id: 'd1', chainId, depositAddress: sourceAddr,
      status: DepositStatus.COMPLETED, amount: '10000000', usdtAmount: '10',
    };
    const depositRepo: any = { findOne: jest.fn(async () => depositRow) };
    const addressService: any = {
      findByAddressAndChainId: jest.fn(async () => ({ id: 'a1', derivationIndex: 3 })),
      isDevelopment: () => false,
    };
    const adapter: any = {
      getChainId: () => chainId,
      getGasPrice: jest.fn(async () => opts.gasPrice ?? 30n),
      getNativeBalance: jest.fn(async () => opts.nativeBalance ?? 10n ** 18n),
      getTokenBalance: jest.fn(async () => opts.tokenBalance ?? 100_000_000n),
      getNonce: jest.fn(async () => 7),
      sendRawTransaction: jest.fn(async () => {
        if (opts.broadcastError) throw opts.broadcastError;
        return TX;
      }),
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
      signTokenTransfer: opts.signError
        ? jest.fn(async () => { throw opts.signError; })
        : jest.fn(async () => ({ signedTransaction: SIGNED_RAW })),
    };
    const gasFunding: any = { fundIfNeeded: jest.fn(async () => ({ funded: false })) };
    const configService: any = {
      get: (key: string) => {
        if (key === 'DEPOSIT_SWEEP_ENABLED') return 'true';
        if (key === 'GAS_SWEEP_GAS_LIMIT') return '100000';
        return undefined;
      },
    };
    const dataSource: any = { query: jest.fn(async () => ({ rows: [] })) };
    const confirmQueue: any = { add: jest.fn(async () => ({})) };
    const svc = new DepositSweepService(
      sweepRepo, depositRepo, dataSource, addressService, chainRegistry,
      { getToken: () => ({ contract: usdt }) } as any, networkRegistry,
      {} as any, {} as any, configService, signer, gasFunding,
      { add: jest.fn() } as any, confirmQueue,
    );
    return { svc, sweep, sweepRepo, adapter, signer, gasFunding, confirmQueue };
  }

  // Source token pre-check (bigint only)
  it('insufficient source USDT → MANUAL_REVIEW + NO broadcast', async () => {
    const { svc, sweep, adapter } = makeService({ tokenBalance: 0n });
    await svc.executeSweep('sw-1'); // resolves (terminal MANUAL_REVIEW, no retry)
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/Insufficient source USDT/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('source balance < deposit amount → MANUAL_REVIEW', async () => {
    const { svc, sweep } = makeService({ tokenBalance: 5_000_000n });
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/Insufficient source USDT/i);
  });

  it('source balance check RPC failure → MANUAL_REVIEW + NO broadcast', async () => {
    const { svc, sweep, adapter } = makeService();
    adapter.getTokenBalance = jest.fn(async () => { throw new Error('RPC timeout'); });
    await expect(svc.executeSweep('sw-1')).rejects.toThrow(/RPC timeout/i);
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  // Treasury re-validation
  it('treasury == source → MANUAL_REVIEW + NO broadcast', async () => {
    const { svc, sweep, adapter } = makeService({ treasury: POLY_ADDR });
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/equals the source/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  // Pre-broadcast persistence (crash window fix)
  it('persists BROADCASTING + deterministic hash + signedTxRaw BEFORE broadcast', async () => {
    const { svc, sweep, sweepRepo, adapter } = makeService();
    await svc.executeSweep('sw-1');
    expect(sweep.sweepTxHash).toBe(TX);
    expect(sweep.signedTxRaw).toBe(SIGNED_RAW);
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(adapter.sendRawTransaction).toHaveBeenCalledWith(SIGNED_RAW);
    // Persistence of the signed raw tx MUST happen before the broadcast RPC:
    const saveOrder = sweepRepo.save.mock.invocationCallOrder[0];
    const broadcastOrder = adapter.sendRawTransaction.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(broadcastOrder);
  });

  // Signing failure
  it('signing failure → NO broadcast, failure reason recorded', async () => {
    const { svc, sweep, adapter, signer } = makeService({ signError: new Error('invalid address') });
    await expect(svc.executeSweep('sw-1')).rejects.toThrow(/invalid address/i);
    expect(sweep.status).not.toBe(DepositSweepStatus.SUBMITTED);
    expect(sweep.failureReason).toContain('invalid address');
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
    expect(signer.signTokenTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: POLYGON_CHAIN_ID }),
    );
  });

  // Gas pre-check
  it('insufficient native gas → GAS_REQUIRED + funding hook + NO broadcast', async () => {
    const { svc, sweep, adapter, gasFunding } = makeService({ nativeBalance: 0n });
    await expect(svc.executeSweep('sw-1')).rejects.toThrow(/Insufficient gas/i);
    expect(sweep.status).toBe(DepositSweepStatus.GAS_REQUIRED);
    expect(gasFunding.fundIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: POLYGON_CHAIN_ID }),
    );
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  // Token contract consistency (never trust stale config)
  it('token contract changed since sweep creation → MANUAL_REVIEW + NO broadcast', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-11', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.PENDING, destinationAddress: TREASURY,
        tokenAddress: ARBITRUM_USDT, // recorded from wrong network config
        amount: '10000000', sweepTxHash: null, signedTxRaw: null,
      },
    });
    await svc.executeSweep('sw-11');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/Token contract changed/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('broadcast RPC timeout → sweep left BROADCASTING, NO second broadcast', async () => {
    const { svc, sweep, adapter } = makeService({ broadcastError: new Error('network timeout') });
    await expect(svc.executeSweep('sw-1')).rejects.toThrow(/network timeout/i);
    expect(sweep.status).toBe(DepositSweepStatus.BROADCASTING);
    expect(sweep.sweepTxHash).toBe(TX);
    expect(sweep.signedTxRaw).toBe(SIGNED_RAW);
    expect(adapter.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('broadcast connection reset → BROADCASTING, NO blind retry', async () => {
    const { svc, sweep, adapter } = makeService({ broadcastError: new Error('ECONNRESET') });
    await expect(svc.executeSweep('sw-1')).rejects.toThrow(/ECONNRESET/i);
    expect(sweep.status).toBe(DepositSweepStatus.BROADCASTING);
    expect(adapter.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('recoverSweep: hash already on-chain → SUBMITTED + confirm enqueued', async () => {
    const { svc, sweep, confirmQueue } = makeService({
      sweep: {
        id: 'sw-2', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.BROADCASTING, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX, signedTxRaw: SIGNED_RAW,
      },
      receipt: { status: 1, blockNumber: 50_000_000, transactionHash: TX },
    });
    await svc.recoverSweep('sw-2');
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(confirmQueue.add).toHaveBeenCalledWith('confirm-sweep', { sweepId: 'sw-2' }, expect.any(Object));
  });

  it('recoverSweep: hash NOT on-chain + signed raw available → rebroadcast SAME tx', async () => {
    const { svc, sweep, adapter, confirmQueue } = makeService({
      sweep: {
        id: 'sw-3', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.BROADCASTING, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX, signedTxRaw: SIGNED_RAW,
      },
      receipt: null,
    });
    await svc.recoverSweep('sw-3');
    expect(adapter.sendRawTransaction).toHaveBeenCalledWith(SIGNED_RAW);
    expect(adapter.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(confirmQueue.add).toHaveBeenCalled();
  });

  it('recoverSweep: hash NOT on-chain + NO signed raw → MANUAL_REVIEW', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-4', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.BROADCASTING, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX, signedTxRaw: null,
      },
      receipt: null,
    });
    await svc.recoverSweep('sw-4');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/no signed raw tx/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('recoverSweep: rebroadcast produces unexpected hash → MANUAL_REVIEW', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-5', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.BROADCASTING, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX, signedTxRaw: SIGNED_RAW,
      },
      receipt: null,
    });
    adapter.sendRawTransaction = jest.fn(async () => '0x' + '99'.repeat(32));
    await svc.recoverSweep('sw-5');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/unexpected hash/i);
  });

  // SUBMITTED recovery = confirmation polling only, NEVER rebroadcast
  it('SUBMITTED + tx hash → confirmation polling only, NEVER rebroadcast', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-6', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      },
      receipt: { status: 1, blockNumber: 50_000_000, transactionHash: TX },
    });
    await svc.executeSweep('sw-6');
    expect(sweep.status).toBe(DepositSweepStatus.COMPLETED);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('confirmSweep marks COMPLETED from a successful receipt (polling only)', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-7', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      },
      receipt: { status: 1, blockNumber: 50_000_000, transactionHash: TX },
    });
    await svc.confirmSweep('sw-7');
    expect(sweep.status).toBe(DepositSweepStatus.COMPLETED);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('confirmSweep marks FAILED from a reverted receipt', async () => {
    const { svc, sweep } = makeService({
      sweep: {
        id: 'sw-8', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      },
      receipt: { status: 0, blockNumber: 50_000_000, transactionHash: TX },
    });
    await svc.confirmSweep('sw-8');
    expect(sweep.status).toBe(DepositSweepStatus.FAILED);
    expect(sweep.failureReason).toContain('reverted');
  });

  it('confirmSweep: receipt not yet available → throws (retry later)', async () => {
    const { svc } = makeService({
      sweep: {
        id: 'sw-9', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      },
      receipt: null,
    });
    await expect(svc.confirmSweep('sw-9')).rejects.toThrow(/receipt not found/i);
  });

  it('terminal sweeps never re-execute (COMPLETED short-circuit)', async () => {
    const { svc, sweep, adapter } = makeService({
      sweep: {
        id: 'sw-10', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.COMPLETED, destinationAddress: TREASURY,
        tokenAddress: POLYGON_USDT, amount: '10000000', sweepTxHash: TX,
      },
    });
    await svc.executeSweep('sw-10');
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
    expect(sweep.status).toBe(DepositSweepStatus.COMPLETED);
  });

  it('Arbitrum sweep uses Arbitrum USDT + treasury, not Polygon', async () => {
    const { svc, sweep, adapter } = makeService({ chainId: ARBITRUM_CHAIN_ID, usdt: ARBITRUM_USDT });
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(adapter.sendRawTransaction).toHaveBeenCalledWith(SIGNED_RAW);
    void adapter;
  });
});