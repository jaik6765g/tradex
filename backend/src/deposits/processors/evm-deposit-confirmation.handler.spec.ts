import {
  EvmDepositConfirmationHandler,
  EVM_CONFIRMATION_SUPPORTED_CHAINS,
} from './evm-deposit-confirmation.handler';
import { EvmDepositAdapter } from '../../deposit-gateway/chains/evm/evm-deposit-adapter';
import { DepositStatus } from '../../deposits/deposit.entity';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

const POLYGON_CHAIN = 137;
const ARBITRUM_CHAIN = 42161;
const TX = '0x' + 'ab'.repeat(32);

function deposit(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'dep-1',
    userId: 'user-1',
    chainId: POLYGON_CHAIN,
    transactionHash: TX,
    status: DepositStatus.PENDING,
    blockNumber: 50_000_000,
    requiredConfirmations: 12,
    ...overrides,
  };
}

function makeHandler(depositRow: any, env: Record<string, string> = {}) {
  // Default env marks both Polygon and Arbitrum as configured (RPC present),
  // so adapterFor() can build an EvmDepositAdapter. Tests override as needed.
  const fullEnv = {
    POLYGON_RPC_URL: 'https://polygon-rpc.test',
    ARBITRUM_RPC_URL: 'https://arbitrum-rpc.test',
    ...env,
  };
  const depositService = {
    getDepositById: jest.fn(async () => depositRow),
    updateConfirmations: jest.fn(async (_id: string, c: number) => {
      depositRow.confirmations = c;
      if (c >= depositRow.requiredConfirmations) {
        depositRow.status = DepositStatus.VERIFIED;
      }
      return depositRow;
    }),
    updateDepositStatus: jest.fn(async (_id: string, s: string) => {
      depositRow.status = s;
      return depositRow;
    }),
  };
  const queue = {
    add: jest.fn(async () => ({})),
  } as unknown as Queue;
  const configService = {
    get: (key: string) => fullEnv[key],
  } as unknown as ConfigService;
  const handler = new EvmDepositConfirmationHandler(
    depositService as any,
    configService,
    queue,
  );
  return { handler, depositService, queue };
}

function job(data: Record<string, unknown>): any {
  return { data } as any;
}

describe('EvmDepositConfirmationHandler (Polygon + Arbitrum)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('supports exactly Polygon and Arbitrum chain ids', () => {
    const { handler } = makeHandler(deposit());
    expect(handler.isSupportedChain(POLYGON_CHAIN)).toBe(true);
    expect(handler.isSupportedChain(ARBITRUM_CHAIN)).toBe(true);
    // BSC and other chains intentionally NOT routed here.
    expect(handler.isSupportedChain(56)).toBe(false);
    expect(handler.isSupportedChain(1)).toBe(false);
    expect(EVM_CONFIRMATION_SUPPORTED_CHAINS.size).toBe(2);
  });

  it('marks VERIFIED and enqueues credit exactly at the threshold', async () => {
    const row = deposit();
    const { handler, depositService, queue } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 1, blockNumber: 50_000_000, transactionHash: TX });
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getConfirmations')
      .mockResolvedValue(12); // exactly threshold

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );

    expect(depositService.updateConfirmations).toHaveBeenCalledWith('dep-1', 12);
    expect(row.status).toBe(DepositStatus.VERIFIED);
    expect(queue.add).toHaveBeenCalledWith(
      'credit-deposit',
      { depositId: 'dep-1', userId: 'user-1' },
      expect.objectContaining({ jobId: 'evm-credit-dep-1' }),
    );
  });

  it('stays pending BELOW the threshold (no credit before confirmation)', async () => {
    const row = deposit();
    const { handler, queue } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 1, blockNumber: 50_000_000, transactionHash: TX });
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getConfirmations')
      .mockResolvedValue(11);

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );

    expect(row.status).toBe(DepositStatus.PENDING);
    expect(queue.add).toHaveBeenCalledWith(
      'confirm-deposit',
      expect.objectContaining({ depositId: 'dep-1', chainId: POLYGON_CHAIN }),
      expect.objectContaining({ delay: 30000 }),
    );
    const creditCalls = (queue.add as jest.Mock).mock.calls.filter(
      (c: any[]) => c[0] === 'credit-deposit',
    );
    expect(creditCalls.length).toBe(0);
  });

  it('marks FAILED for reverted transactions (no credit)', async () => {
    const row = deposit();
    const { handler, depositService, queue } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 0, blockNumber: 50_000_000, transactionHash: TX });

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );

    expect(depositService.updateDepositStatus).toHaveBeenCalledWith(
      'dep-1',
      DepositStatus.FAILED,
      expect.stringContaining('reverted'),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('throws when receipt missing (job retries, nothing mutated)', async () => {
    const row = deposit();
    const { handler, depositService, queue } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue(null);

    await expect(
      handler.handle(
        job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
      ),
    ).rejects.toThrow(/receipt not found/i);
    expect(depositService.updateConfirmations).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('never confirms a deposit against another chain transaction (cross-network)', async () => {
    const row = deposit({ chainId: POLYGON_CHAIN });
    const { handler, queue } = makeHandler(row);
    const receiptSpy = jest.spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt');

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: ARBITRUM_CHAIN }),
    );

    expect(receiptSpy).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(row.status).toBe(DepositStatus.PENDING);
  });

  it('is idempotent for duplicate confirmation jobs (already completed)', async () => {
    const row = deposit({ status: DepositStatus.COMPLETED });
    const { handler, queue } = makeHandler(row);
    const receiptSpy = jest.spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt');

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );
    expect(receiptSpy).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('recomputes confirmations from the chain (never trusts stored counts)', async () => {
    const row = deposit({ confirmations: 999 }); // stale stored count
    const { handler, depositService } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 1, blockNumber: 50_000_000, transactionHash: TX });
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getConfirmations')
      .mockResolvedValue(3);

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );

    expect(depositService.updateConfirmations).toHaveBeenCalledWith('dep-1', 3);
    expect(row.confirmations).toBe(3);
  });

  it('does not re-credit a deposit whose status changed underneath', async () => {
    const row = deposit({ status: DepositStatus.VERIFIED });
    const { handler, queue } = makeHandler(row);
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 1, blockNumber: 50_000_000, transactionHash: TX });
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getConfirmations')
      .mockResolvedValue(12);

    // Concurrent transition to FAILED between updateConfirmations and refresh.
    (handler as any).depositService = null; // guard against accidental use
    const refreshed = { ...row, status: DepositStatus.FAILED };
    (handler as any).depositService = {
      getDepositById: jest
        .fn()
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(refreshed),
      updateConfirmations: jest.fn(),
      updateDepositStatus: jest.fn(),
    };

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: POLYGON_CHAIN }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('works identically for Arbitrum (generic engine, not a separate engine)', async () => {
    const row = deposit({ chainId: ARBITRUM_CHAIN });
    const { handler, queue } = makeHandler(row);
    const receiptSpy = jest
      .spyOn(EvmDepositAdapter.prototype, 'getTransactionReceipt')
      .mockResolvedValue({ status: 1, blockNumber: 50_000_000, transactionHash: TX });
    jest
      .spyOn(EvmDepositAdapter.prototype, 'getConfirmations')
      .mockResolvedValue(15); // above threshold

    await handler.handle(
      job({ depositId: 'dep-1', transactionHash: TX, chainId: ARBITRUM_CHAIN }),
    );

    expect(receiptSpy).toHaveBeenCalledWith(TX);
    expect(row.status).toBe(DepositStatus.VERIFIED);
    expect(queue.add).toHaveBeenCalledWith(
      'credit-deposit',
      expect.anything(),
      expect.objectContaining({ jobId: 'evm-credit-dep-1' }),
    );
  });
});