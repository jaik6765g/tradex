import {
  isSufficientGas,
  tronSweepGasSun,
  TronDepositSweepService,
} from './tron-sweep.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TronCustodySigner } from './tron-custody-signer';
import { DepositSweepStatus } from '../../sweeps/deposit-sweep.entity';
import type { ConfigService } from '@nestjs/config';

function config(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('tron sweep gas helpers', () => {
  it('converts whole-TRX gas config to sun', () => {
    expect(tronSweepGasSun(20)).toBe(20_000_000n);
    expect(tronSweepGasSun(1)).toBe(1_000_000n);
    expect(tronSweepGasSun(0)).toBe(1_000_000n);
    expect(tronSweepGasSun(NaN)).toBe(1_000_000n);
  });

  it('checks gas sufficiency', () => {
    expect(isSufficientGas(20_000_000n, 20_000_000n)).toBe(true);
    expect(isSufficientGas(19_999_999n, 20_000_000n)).toBe(false);
  });
});

describe('TronDepositSweepService', () => {
  const DEPOSIT_ADDR = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
  const TRESURY = 'TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK';

  const sweep = {
    id: 's1',
    chainId: 195,
    depositId: 'd1',
    depositAddressId: 'a1',
    status: 'PENDING',
    sweepTxHash: null,
    tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  } as any;
  const deposit = {
    id: 'd1',
    chainId: 195,
    depositAddress: DEPOSIT_ADDR,
    amount: '1000000',
  } as any;
  const addressEntity = { id: 'a1', derivationIndex: 0 } as any;

  function makeService(options: {
    env: Record<string, string>;
    sweepOverrides?: Record<string, unknown>;
    adapterFactory?: (network: any) => {
      getTransactionInfo: jest.Mock;
      getNativeBalance: jest.Mock;
      getTokenBalance: jest.Mock;
    };
  }): {
    service: TronDepositSweepService;
    sweepRepoSave: jest.Mock;
    dataSourceQuery: jest.Mock;
  } {
    const networkRegistry = new NetworkRegistryService(config(options.env));
    const signer = new TronCustodySigner(
      config({
        DEPOSIT_WALLET_MNEMONIC:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      }),
    );
    const sweepRepo = {
      findOne: async () => ({ ...sweep, ...(options.sweepOverrides ?? {}) }),
      save: jest.fn(async (s: any) => s),
    } as any;
    const depositRepo = { findOne: async () => ({ ...deposit }) } as any;
    const addressService = {
      findByAddressAndChainId: async () => ({ ...addressEntity }),
    } as any;
    const gasFunding = {
      fundIfNeeded: jest.fn(async () => ({ funded: false })),
    } as any;
    const confirmQueue = { add: jest.fn(async () => ({})) } as any;
    const dataSource = { query: jest.fn(async () => []) } as any;

    const service = new TronDepositSweepService(
      sweepRepo,
      depositRepo,
      addressService,
      networkRegistry,
      config(options.env),
      signer,
      dataSource,
      gasFunding,
      confirmQueue,
    );
    if (options.adapterFactory) {
      service.adapterFactory = options.adapterFactory as any;
    }
    return { service, sweepRepoSave: sweepRepo.save, dataSourceQuery: dataSource.query };
  }

  it('flags MANUAL_REVIEW when the TRON treasury is not configured', async () => {
    const { service, sweepRepoSave } = makeService({
      env: { TRON_RPC_URL: 'https://api.trongrid.io', TRON_DEPOSIT_ENABLED: 'true' },
    });
    await service.executeTronSweep('s1');
    expect(sweepRepoSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.MANUAL_REVIEW }),
    );
  });

  it('flags MANUAL_REVIEW when the treasury equals the source (self-transfer)', async () => {
    const { service, sweepRepoSave } = makeService({
      env: {
        TRON_RPC_URL: 'https://api.trongrid.io',
        TRON_DEPOSIT_ENABLED: 'true',
        TRON_TREASURY_ADDRESS: DEPOSIT_ADDR,
      },
    });
    await service.executeTronSweep('s1');
    expect(sweepRepoSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.MANUAL_REVIEW }),
    );
  });

  it('flags MANUAL_REVIEW when sweep token mismatches configured TRON USDT', async () => {
    const { service, sweepRepoSave } = makeService({
      env: {
        TRON_RPC_URL: 'https://api.trongrid.io',
        TRON_DEPOSIT_ENABLED: 'true',
        TRON_TREASURY_ADDRESS: TRESURY,
      },
      sweepOverrides: { tokenAddress: 'TOtherContract' },
    });
    await service.executeTronSweep('s1');
    expect(sweepRepoSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.MANUAL_REVIEW }),
    );
  });

  it('routes to MANUAL_REVIEW when TRON custody signing is not configured', async () => {
    const env = {
      TRON_RPC_URL: 'https://api.trongrid.io',
      TRON_DEPOSIT_ENABLED: 'true',
      TRON_TREASURY_ADDRESS: TRESURY,
      DEPOSIT_SWEEP_ENABLED: 'true',
    };
    const networkRegistry = new NetworkRegistryService(config(env));
    const signer = new TronCustodySigner(config({}));
    const sweepRepo = {
      findOne: async () => ({ ...sweep }),
      save: jest.fn(async (s: any) => s),
    } as any;
    const svc = new TronDepositSweepService(
      sweepRepo,
      { findOne: async () => ({ ...deposit }) } as any,
      { findByAddressAndChainId: async () => ({ ...addressEntity }) } as any,
      networkRegistry,
      config(env),
      signer,
      { query: jest.fn(async () => []) } as any,
      { fundIfNeeded: jest.fn(async () => ({ funded: false })) } as any,
      { add: jest.fn() } as any,
    );
    await svc.executeTronSweep('s1');
    expect(sweepRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.MANUAL_REVIEW }),
    );
  });

  it('recovers a SUBMITTED sweep without re-broadcasting (confirm path only)', async () => {
    const { service, sweepRepoSave, dataSourceQuery } = makeService({
      env: {
        TRON_RPC_URL: 'https://api.trongrid.io',
        TRON_DEPOSIT_ENABLED: 'true',
        TRON_TREASURY_ADDRESS: TRESURY,
      },
      sweepOverrides: { status: 'SUBMITTED', sweepTxHash: '0xdeadbeef' },
      adapterFactory: () => ({
        getTransactionInfo: jest.fn(async () => ({ blockNumber: 1, success: true })),
        getNativeBalance: jest.fn(),
        getTokenBalance: jest.fn(),
      }),
    });
    await service.executeTronSweep('s1');
    expect(sweepRepoSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.COMPLETED }),
    );
    // No advisory lock → no attempt to re-broadcast.
    expect(dataSourceQuery).not.toHaveBeenCalled();
  });

  it('marks a reverted TRON sweep as FAILED', async () => {
    const { service, sweepRepoSave } = makeService({
      env: {
        TRON_RPC_URL: 'https://api.trongrid.io',
        TRON_DEPOSIT_ENABLED: 'true',
        TRON_TREASURY_ADDRESS: TRESURY,
      },
      sweepOverrides: { status: 'SUBMITTED', sweepTxHash: '0xreverted' },
      adapterFactory: () => ({
        getTransactionInfo: jest.fn(async () => ({ blockNumber: 1, success: false })),
        getNativeBalance: jest.fn(),
        getTokenBalance: jest.fn(),
      }),
    });
    await service.executeTronSweep('s1');
    expect(sweepRepoSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: DepositSweepStatus.FAILED }),
    );
  });
});