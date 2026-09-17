import { GatewayDepositDetectionProcessor } from '../../processors/gateway-deposit-detection.processor';
import { POLYGON_CHAIN_ID, ARBITRUM_CHAIN_ID } from '../../config/networks.config';

const POLYGON_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const ARBITRUM_USDT = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const POLY_ADDR = '0xaAdDaaa57e6bB4Db7B3f4A4f4e1c7e1C0D3f3b3a';
const ARB_ADDR = '0xBbAaAaA57E6BB4DB7b3F4a4F4E1C7e1c0d3f3B3B';
const TX = '0x' + 'cd'.repeat(32);

function makeProcessor(chainId: number, tokenAddress: string) {
  const adapter: any = {
    getChainId: () => chainId,
    getTokenAddress: () => tokenAddress,
    getTransactionReceipt: jest.fn(async () => ({
      status: 1,
      blockNumber: 50_000_000,
      transactionHash: TX,
    })),
    getConfirmations: jest.fn(async () => 3),
    getBlockTimestamp: jest.fn(async () => 1_700_000_000),
    getRequiredConfirmations: () => 12,
  };
  const chainRegistry: any = { getAdapter: () => adapter };
  const depositService: any = {
    createDeposit: jest.fn(async (data: any) => ({ id: 'dep-new', ...data })),
  };
  const addressService: any = {
    // Chain-scoped binding: each address belongs to exactly one chain.
    findByAddressAndChainId: jest.fn(async (address: string, cid: number) => {
      if (address === POLY_ADDR && cid === POLYGON_CHAIN_ID) {
        return { address: POLY_ADDR, userId: 'u1', orderId: 'o1' };
      }
      if (address === ARB_ADDR && cid === ARBITRUM_CHAIN_ID) {
        return { address: ARB_ADDR, userId: 'u2', orderId: 'o2' };
      }
      return null;
    }),
  };
  const tokenRegistry: any = {
    getToken: () => ({ decimals: 6, tdxRate: 100 }),
  };
  const confirmationQueue: any = { add: jest.fn(async () => ({})) };
  const processor = new GatewayDepositDetectionProcessor(
    depositService,
    addressService,
    tokenRegistry,
    chainRegistry,
    confirmationQueue,
  );
  return {
    processor,
    adapter,
    depositService,
    addressService,
    confirmationQueue,
  };
}

function log(overrides: Record<string, unknown> = {}): any {
  return {
    data: {
      chainId: POLYGON_CHAIN_ID,
      transactionHash: TX,
      blockNumber: 50_000_000,
      logIndex: 0,
      from: '0x1111111111111111111111111111111111111111',
      to: POLY_ADDR,
      amount: '1000000',
      tokenAddress: POLYGON_USDT,
      detectedAt: new Date().toISOString(),
      ...overrides,
    },
  } as any;
}

describe('CROSS-NETWORK DETECTION + CREDIT ISOLATION', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a Polygon USDT transfer is rejected on the Arbitrum engine (wrong token)', async () => {
    const { processor, depositService, adapter } = makeProcessor(
      ARBITRUM_CHAIN_ID,
      ARBITRUM_USDT,
    );
    await processor.process(
      log({ chainId: ARBITRUM_CHAIN_ID, to: ARB_ADDR, tokenAddress: POLYGON_USDT }),
    );
    expect(depositService.createDeposit).not.toHaveBeenCalled();
    // Receipt must not even be fetched once the token mismatch is detected.
    expect(adapter.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it('an Arbitrum transaction cannot be credited as Polygon (chain-scoped recipient)', async () => {
    const { processor, addressService, depositService, confirmationQueue } =
      makeProcessor(ARBITRUM_CHAIN_ID, ARBITRUM_USDT);
    await processor.process(
      log({
        chainId: ARBITRUM_CHAIN_ID,
        to: POLY_ADDR, // Polygon address on an Arbitrum job
        tokenAddress: ARBITRUM_USDT,
      }),
    );
    expect(addressService.findByAddressAndChainId).toHaveBeenCalledWith(
      expect.any(String),
      ARBITRUM_CHAIN_ID,
    );
    expect(depositService.createDeposit).not.toHaveBeenCalled();
    expect(confirmationQueue.add).not.toHaveBeenCalled();
  });

  it('credit is chain-scoped from detection: deposit row carries its own chainId', async () => {
    const { processor, depositService, confirmationQueue } = makeProcessor(
      POLYGON_CHAIN_ID,
      POLYGON_USDT,
    );
    await processor.process(log());
    expect(depositService.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: POLYGON_CHAIN_ID,
        transactionHash: TX,
        requiredConfirmations: 12,
      }),
    );
    const confirmCall = (confirmationQueue.add as jest.Mock).mock.calls[0];
    expect(confirmCall[0]).toBe('confirm-deposit');
    expect(confirmCall[1].chainId).toBe(POLYGON_CHAIN_ID);
    // No sender-based identity: sender is stored informational only.
    expect(depositService.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress: '0x1111111111111111111111111111111111111111',
      }),
    );
  });

  it('1 USDT = 100 TDX preserved with 6-decimal USDT (generic credit math)', async () => {
    const { processor, depositService } = makeProcessor(
      POLYGON_CHAIN_ID,
      POLYGON_USDT,
    );
    await processor.process(log({ amount: '5000000' })); // 5 USDT
    expect(depositService.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        usdtAmount: '5.0',
        tdxAmount: '500.0', // 5 × 100
      }),
    );
  });

  it('reverted transactions are rejected (no deposit, no confirm job)', async () => {
    const { processor, depositService, confirmationQueue, adapter } =
      makeProcessor(POLYGON_CHAIN_ID, POLYGON_USDT);
    adapter.getTransactionReceipt = jest.fn(async () => ({
      status: 0,
      blockNumber: 50_000_000,
      transactionHash: TX,
    }));
    await processor.process(log());
    expect(depositService.createDeposit).not.toHaveBeenCalled();
    expect(confirmationQueue.add).not.toHaveBeenCalled();
  });

  it('zero-amount transfers are ignored', async () => {
    const { processor, depositService } = makeProcessor(
      POLYGON_CHAIN_ID,
      POLYGON_USDT,
    );
    await processor.process(log({ amount: '0' }));
    expect(depositService.createDeposit).not.toHaveBeenCalled();
  });

  it('unassigned recipients are ignored (deposit-address attribution only)', async () => {
    const { processor, depositService } = makeProcessor(
      POLYGON_CHAIN_ID,
      POLYGON_USDT,
    );
    await processor.process(log({ to: ARB_ADDR })); // not a Polygon deposit address
    expect(depositService.createDeposit).not.toHaveBeenCalled();
  });
});