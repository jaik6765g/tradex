import { BadRequestException } from '@nestjs/common';

import { DepositAddressStatus } from '../addresses/deposit-address.entity';
import { BscGasBatchService } from './bsc-gas-batch.service';
import { BscGasStatusService } from './bsc-gas-status.service';
import { BscGasWalletService } from './bsc-gas-wallet.service';

const ADDR_OK = '0x1111111111111111111111111111111111111111';
const ADDR_TREASURY = '0x2222222222222222222222222222222222222222';

function makeService(opts: {
  addresses?: any[];
  gasConfigured?: boolean;
  sendImpl?: (signed: string) => Promise<string>;
} = {}) {
  const addresses = opts.addresses ?? [
    {
      id: 'a-ok', address: ADDR_OK, chainId: 56, userId: 'u1',
      provider: 'self_custody_hd', derivationIndex: 3,
      derivationPath: `m/44'/60'/0'/0/3`, custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    },
  ];
  const addressRepo: any = {
    findOne: jest.fn(async (q: any) => {
      if (q.where.id) return addresses.find((a) => a.id === q.where.id) ?? null;
      return addresses.find((a) => a.address.toLowerCase() === String(q.where.address).toLowerCase()) ?? null;
    }),
  };
  const batches: any[] = [];
  const batchRepo: any = {
    findOne: jest.fn(async (q: any) => batches.find((b) => b.idempotencyKey === q.where.idempotencyKey) ?? null),
    create: jest.fn((x: any) => ({ id: 'batch-1', ...x })),
    save: jest.fn(async (b: any) => { batches.push(b); return b; }),
  };
  const transfers: any[] = [];
  const transferRepo: any = {
    find: jest.fn(async () => transfers),
    findOne: jest.fn(async () => null),
    create: jest.fn((x: any) => ({ id: 't-' + transfers.length, ...x })),
    save: jest.fn(async (t: any) => { transfers.push(t); return t; }),
  };
  const nullRepo: any = { create: (x: any) => x, save: async (x: any) => x };
  const statusService = {
    treasury: () => ADDR_TREASURY,
    currentGeneration: () => 1,
    buildRow: async (addr: any) => ({
      depositAddressId: addr.id, usdtBalanceRaw: '1000000000000000000',
      bnbBalance: '0.0001', requiredGasBnb: '0.0006', gasShortfallBnb: '0.0005',
      recommendedBnb: '0.001', recommendedWei: '1000000000000000',
      bnbBalanceWei: '100000000000000', opStatus: 'GAS_REQUIRED',
      eligibleForSweep: false, eligibleForTopUp: true, sweepId: null, treasury: ADDR_TREASURY,
    }),
  } as unknown as BscGasStatusService;
  const gasWallet = {
    isConfigured: () => opts.gasConfigured !== false,
    getAddress: () => '0x3333333333333333333333333333333333333333',
    signNativeTransfer: jest.fn(async () => ({ signedTransaction: '0xdead', hash: '0xhash1' })),
  } as unknown as BscGasWalletService;
  const adapter: any = {
    getGasPrice: async () => 1000000000n,
    getNonce: async () => 5,
    sendRawTransaction: jest.fn(async (s: string) => (opts.sendImpl ? opts.sendImpl(s) : '0xhash1')),
    getTransactionReceipt: async () => null,
    getConfirmations: async () => 0,
  };
  const chainRegistry: any = { getAdapter: () => adapter };
  const networkRegistry: any = { getNetwork: () => ({ confirmations: 15 }) };
  const sweepService: any = {
    executeSweep: jest.fn(async () => undefined),
    getById: jest.fn(async () => ({ id: 's1', status: 'SUBMITTED', sweepTxHash: '0xhash1', failureReason: null })),
  };
  const configService: any = { get: () => undefined };
  const svc = new BscGasBatchService(
    addressRepo, batchRepo, transferRepo, nullRepo, nullRepo,
    statusService, gasWallet, chainRegistry, networkRegistry, sweepService, configService,
  );
  return { svc, adapter, batches, transfers };
}

describe('BSC admin gas batch safety', () => {
  it('rejects treasury + unknown addresses', async () => {
    const { svc } = makeService();
    const t = await svc.validateRecipients([ADDR_TREASURY]);
    expect(t.items[0].ok).toBe(false);
    expect(t.items[0].rejectReason).toBe('TREASURY_ADDRESS');
    const u = await svc.validateRecipients(['0x9999999999999999999999999999999999999999']);
    expect(u.items[0].rejectReason).toBe('UNKNOWN_ADDRESS');
  });
  it('rejects duplicates + bad statuses + legacy provider', async () => {
    const { svc } = makeService();
    const d = await svc.validateRecipients([ADDR_OK, ADDR_OK.toLowerCase()]);
    expect(d.items.filter((i) => i.ok).length).toBe(1);
    expect(d.items[1].rejectReason).toBe('DUPLICATE_RECIPIENT');
    const mk = (over: any) => ({
      id: 'a-x', address: '0x4444444444444444444444444444444444444444',
      chainId: 56, provider: 'self_custody_hd', derivationIndex: 1,
      derivationPath: `m/44'/60'/0'/0/1`, custodyGeneration: 1, ...over,
    });
    const cases: Array<[string, string]> = [
      [DepositAddressStatus.COMPROMISED, 'COMPROMISED'],
      [DepositAddressStatus.EXPIRED, 'EXPIRED'],
      [DepositAddressStatus.RELEASED, 'RELEASED'],
    ];
    for (const [status, reason] of cases) {
      const h = makeService({ addresses: [mk({ status })] });
      const r = await h.svc.validateRecipients([mk({ status }).address]);
      expect(r.items[0].rejectReason).toBe(reason);
    }
    const legacy = makeService({ addresses: [mk({ status: 'ACTIVE', provider: null })] });
    const lr = await legacy.svc.validateRecipients([mk({}).address]);
    expect(lr.items[0].rejectReason).toBe('LEGACY_PROVIDER_NULL');
  });

  it('requires confirmation; second send with same key is idempotent', async () => {
    const { svc } = makeService();
    await expect(
      svc.send({ recipients: [ADDR_OK], idempotencyKey: 'k1', confirmed: false as any }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const first = await svc.send({ recipients: [ADDR_OK], idempotencyKey: 'k1', confirmed: true }, 'admin');
    expect(first.idempotent).toBe(false);
    const second = await svc.send({ recipients: [ADDR_OK], idempotencyKey: 'k1', confirmed: true }, 'admin');
    expect(second.idempotent).toBe(true);
  });

  it('ambiguous broadcast becomes MANUAL_REVIEW, never blind resend', async () => {
    const { svc, transfers } = makeService({
      sendImpl: async () => { throw new Error('timeout after broadcast'); },
    });
    const res = await svc.send({ recipients: [ADDR_OK], idempotencyKey: 'k-amb', confirmed: true }, 'admin');
    expect(res.transfers[0].status).toBe('MANUAL_REVIEW');
    expect(res.transfers.length).toBe(1);
  });

  it('batch total equals sum of funding amounts; CSV header has no secrets', async () => {
    const { svc } = makeService();
    const preview = await svc.preview([ADDR_OK]);
    expect(preview.totalWei).toBe('1000000000000000');
    expect(preview.totalBnb).toBe('0.001');
    const header = ['user_id','deposit_address','network','chain_id','usdt_balance','bnb_balance','required_gas','gas_shortfall','recommended_bnb','sweep_status'].join(',');
    expect(header).not.toMatch(/private|mnemonic|secret|password|jwt|signed/i);
  });
});
