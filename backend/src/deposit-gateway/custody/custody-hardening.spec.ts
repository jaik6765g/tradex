import {
  CustodyState,
  normalizeCustodyState,
  normalizeCustodyGeneration,
  isAllocationAllowed,
  isAutomaticSweepAllowed,
  CUSTODY_STATE_ENV_KEY,
  CUSTODY_GENERATION_ENV_KEY,
} from './custody-state';
import { DepositAddressService } from '../addresses/deposit-address.service';
import { DepositAddressStatus } from '../addresses/deposit-address.entity';
import { DepositSweepStatus } from '../sweeps/deposit-sweep.entity';
import { DepositStatus } from '../../deposits/deposit.entity';
import { DepositSweepService } from '../sweeps/deposit-sweep.service';
import { CustodyEmergencyService } from './custody-emergency.service';
import { POLYGON_CHAIN_ID, ARBITRUM_CHAIN_ID } from '../config/networks.config';
import type { ConfigService } from '@nestjs/config';

import { keccak256 } from 'ethers';

const POLY_ADDR = '0xaAdDaaa57e6bB4Db7B3f4A4f4e1c7e1C0D3f3b3a';
const TREASURY = '0x2222222222222222222222222222222222222222';
const SIGNED_RAW = '0x' + 'ab'.repeat(80);
// Deterministic EVM tx hash must match what sendRawTransaction returns.
const TX = keccak256(SIGNED_RAW);

// ============================================================
// 1. Custody state helper (pure config parsing)
// ============================================================
describe('CustodyState helper', () => {
  it('defaults to NORMAL for unset/invalid values', () => {
    expect(normalizeCustodyState(undefined)).toBe(CustodyState.NORMAL);
    expect(normalizeCustodyState('')).toBe(CustodyState.NORMAL);
    expect(normalizeCustodyState('garbage')).toBe(CustodyState.NORMAL);
  });

  it('parses CUSTODY_LOCKDOWN and RECOVERY case-insensitively', () => {
    expect(normalizeCustodyState('CUSTODY_LOCKDOWN')).toBe(CustodyState.CUSTODY_LOCKDOWN);
    expect(normalizeCustodyState('custody_lockdown')).toBe(CustodyState.CUSTODY_LOCKDOWN);
    expect(normalizeCustodyState('RECOVERY')).toBe(CustodyState.RECOVERY);
  });

  it('normalizes generation with safe fallback', () => {
    expect(normalizeCustodyGeneration(undefined)).toBe(1);
    expect(normalizeCustodyGeneration('abc')).toBe(1);
    expect(normalizeCustodyGeneration('0')).toBe(1);
    expect(normalizeCustodyGeneration('2.5')).toBe(1);
    expect(normalizeCustodyGeneration('2')).toBe(2);
  });

  it('allocation and automatic sweep allowed only in NORMAL', () => {
    expect(isAllocationAllowed(CustodyState.NORMAL)).toBe(true);
    expect(isAllocationAllowed(CustodyState.CUSTODY_LOCKDOWN)).toBe(false);
    expect(isAllocationAllowed(CustodyState.RECOVERY)).toBe(false);
    expect(isAutomaticSweepAllowed(CustodyState.NORMAL)).toBe(true);
    expect(isAutomaticSweepAllowed(CustodyState.CUSTODY_LOCKDOWN)).toBe(false);
  });
});

// ============================================================
// 2-4. Address allocation under custody state + generation stamping
// ============================================================
describe('DepositAddressService — custody-aware allocation', () => {
  function makeAddressService(env: Record<string, string> = {}, existing: any = null) {
    const addresses: any[] = existing ? [existing] : [];
    const repo: any = {
      findOne: jest.fn(async (q: any) => {
        if (q.where.userId && q.where.chainId != null) {
          return (
            addresses.find(
              (a) => a.userId === q.where.userId && a.chainId === q.where.chainId,
            ) ?? null
          );
        }
        if (q.where.id) return addresses.find((a) => a.id === q.where.id) ?? null;
        return null;
      }),
      create: jest.fn((x: any) => ({ id: `addr-${addresses.length + 1}`, ...x })),
      save: jest.fn(async (e: any) => {
        const i = addresses.findIndex((a) => a.id === e.id);
        if (i >= 0) addresses[i] = e;
        else addresses.push(e);
        return e;
      }),
      update: jest.fn(async () => undefined),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({
          max: addresses.reduce((m, a) => Math.max(m, a.derivationIndex ?? -1), -1),
        })),
      })),
    };
    const dataSource: any = { query: jest.fn(async () => ({ rows: [] })) };
    const provider: any = {
      name: 'self_custody_hd',
      isDevelopment: () => false,
      generateAddress: jest.fn((inp: any) => ({
        address:
          inp.derivationIndex === 0 && inp.chainId === POLYGON_CHAIN_ID
            ? POLY_ADDR
            : `0xNew${inp.derivationIndex}0000000000000000000000000000000000000${inp.derivationIndex}`,
        chainId: inp.chainId,
        provider: 'self_custody_hd',
        derivationIndex: inp.derivationIndex,
        derivationPath: `m/44'/60'/0'/0/${inp.derivationIndex}`,
        metadata: { custody: 'self' },
      })),
      validateAddress: () => true,
      getAddressMetadata: () => ({}),
    };
    const configService = { get: (key: string) => env[key] } as unknown as ConfigService;
    const svc = new DepositAddressService(repo as any, dataSource, provider, configService);
    return { svc, repo, addresses, provider, dataSource };
  }

  function makeManager(repo: any, dataSource: any) {
    return { getRepository: () => repo, query: dataSource.query } as any;
  }

  it('NORMAL: allocates a new address stamped with custody generation 2', async () => {
    const { svc, addresses } = makeAddressService({ CUSTODY_GENERATION: '2' });
    const addr = await svc.allocateWithManager(
      makeManager((svc as any).repo, (svc as any).dataSource),
      { chainId: POLYGON_CHAIN_ID, userId: 'user-1', orderId: 'order-1' },
    );
    expect(addr.custodyGeneration).toBe(2);
    expect(addr.status).toBe(DepositAddressStatus.ACTIVE);
    expect(addresses.length).toBe(1);
  });

  it('defaults custody generation to 1 when unset', async () => {
    const { svc } = makeAddressService({});
    const addr = await svc.allocateWithManager(
      makeManager((svc as any).repo, (svc as any).dataSource),
      { chainId: POLYGON_CHAIN_ID, userId: 'user-1', orderId: 'order-1' },
    );
    expect(addr.custodyGeneration).toBe(1);
  });

  it('same user/network returns the SAME existing permanent address', async () => {
    const { svc, addresses } = makeAddressService({}, {
      id: 'addr-existing', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID,
      userId: 'user-1', orderId: 'order-old', provider: 'self_custody_hd',
      derivationIndex: 0, derivationPath: `m/44'/60'/0'/0/0`,
      custodyGeneration: 1, status: DepositAddressStatus.ACTIVE,
    });
    const mgr = makeManager((svc as any).repo, (svc as any).dataSource);
    const first = await svc.allocateWithManager(mgr, {
      chainId: POLYGON_CHAIN_ID, userId: 'user-1', orderId: 'order-new',
    });
    const second = await svc.allocateWithManager(mgr, {
      chainId: POLYGON_CHAIN_ID, userId: 'user-1', orderId: 'order-new2',
    });
    expect(first.id).toBe('addr-existing');
    expect(second.id).toBe('addr-existing');
    expect(first.address).toBe(POLY_ADDR);
    // No new record is created on restart/re-order: eligibility verifies the
    // existing self-custody record (derivable via the provider) and reuses it.
    expect(addresses.length).toBe(1);
  });

  it('CUSTODY_LOCKDOWN: new allocation DENIED, existing records preserved', async () => {
    const existing = {
      id: 'addr-keep', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID,
      userId: 'user-1', orderId: 'order-1', provider: 'self_custody_hd',
      derivationIndex: 0, custodyGeneration: 1, status: DepositAddressStatus.ACTIVE,
    };
    const { svc, addresses } = makeAddressService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN' }, existing);
    await expect(
      svc.allocateWithManager(makeManager((svc as any).repo, (svc as any).dataSource), {
        chainId: POLYGON_CHAIN_ID, userId: 'user-2', orderId: 'order-2',
      }),
    ).rejects.toThrow(/custody state is CUSTODY_LOCKDOWN/i);
    expect(addresses.length).toBe(1);
    expect(addresses[0].id).toBe('addr-keep');
    expect(addresses[0].status).toBe(DepositAddressStatus.ACTIVE);
  });

  it('RECOVERY state: new routine allocation DENIED', async () => {
    const { svc } = makeAddressService({ CUSTODY_STATE: 'RECOVERY' });
    await expect(
      svc.allocateWithManager(makeManager((svc as any).repo, (svc as any).dataSource), {
        chainId: POLYGON_CHAIN_ID, userId: 'user-3', orderId: 'order-3',
      }),
    ).rejects.toThrow(/custody state is RECOVERY/i);
  });

  it('COMPROMISED address is NOT reused — fresh address at next index allocated', async () => {
    const compromised = {
      id: 'addr-comp', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID,
      userId: 'user-1', orderId: 'order-1', provider: 'self_custody_hd',
      derivationIndex: 0, custodyGeneration: 1, status: DepositAddressStatus.COMPROMISED,
    };
    const { svc, addresses, provider } = makeAddressService({}, compromised);
    const fresh = await svc.allocateWithManager(
      makeManager((svc as any).repo, (svc as any).dataSource),
      { chainId: POLYGON_CHAIN_ID, userId: 'user-1', orderId: 'order-2' },
    );
    expect(fresh.id).not.toBe('addr-comp');
    expect(fresh.derivationIndex).toBe(1);
    expect(fresh.address).not.toBe(POLY_ADDR);
    expect(addresses.find((a) => a.id === 'addr-comp')?.status).toBe(
      DepositAddressStatus.COMPROMISED,
    );
    expect(provider.generateAddress).toHaveBeenCalledWith(
      expect.objectContaining({ derivationIndex: 1 }),
    );
  });

  it('different users on different networks never reuse a derivation index', async () => {
    const { svc, addresses } = makeAddressService({}, {
      id: 'addr-a', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID, userId: 'user-A',
      orderId: 'order-A', provider: 'self_custody_hd', derivationIndex: 0,
      custodyGeneration: 1, status: DepositAddressStatus.ACTIVE,
    });
    const mgr = makeManager((svc as any).repo, (svc as any).dataSource);
    await svc.allocateWithManager(mgr, {
      chainId: ARBITRUM_CHAIN_ID, userId: 'user-B', orderId: 'order-B',
    });
    expect(addresses.find((a) => a.userId === 'user-B')?.derivationIndex).toBe(1);
  });

  it('markCompromised sets status and preserves the record', async () => {
    const { svc, addresses } = makeAddressService({}, {
      id: 'addr-x', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID, userId: 'u1',
      orderId: 'o1', provider: 'self_custody_hd', derivationIndex: 2,
      custodyGeneration: 1, status: DepositAddressStatus.ACTIVE,
    });
    const updated = await svc.markCompromised('addr-x');
    expect(updated.status).toBe(DepositAddressStatus.COMPROMISED);
    expect(addresses.find((a) => a.id === 'addr-x')?.address).toBe(POLY_ADDR);
  });
});

// ============================================================
// 7-10. CustodyEmergencyService — compromise, audit, recovery
// ============================================================
describe('CustodyEmergencyService', () => {
  function makeEmergencyService(
    env: Record<string, string> = {},
    addresses: any[] = [],
  ) {
    const auditLogs: any[] = [];
    const addressRepo: any = {
      findOne: jest.fn(async (q: any) =>
        addresses.find((a) => a.id === q.where.id) ?? null,
      ),
      create: jest.fn((x: any) => ({ id: `addr-${addresses.length + 1}`, ...x })),
      save: jest.fn(async (e: any) => {
        const i = addresses.findIndex((a) => a.id === e.id);
        if (i >= 0) addresses[i] = e;
        else addresses.push(e);
        return e;
      }),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({
          max: addresses.reduce((m, a) => Math.max(m, a.derivationIndex ?? -1), -1),
        })),
      })),
    };
    const auditRepo: any = {
      create: jest.fn((x: any) => ({ id: `audit-${auditLogs.length + 1}`, ...x })),
      save: jest.fn(async (e: any) => {
        auditLogs.push(e);
        return e;
      }),
      find: jest.fn(async () => auditLogs),
    };
    const configService = { get: (key: string) => env[key] } as unknown as ConfigService;
    const svc = new CustodyEmergencyService(addressRepo, auditRepo, configService);
    return { svc, auditLogs, addresses };
  }

  it('markAddressCompromised: sets COMPROMISED + writes audit record (no secrets)', async () => {
    const { svc, auditLogs } = makeEmergencyService({}, [
      { id: 'addr-1', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID, userId: 'u1',
        derivationIndex: 0, custodyGeneration: 1, status: DepositAddressStatus.ACTIVE },
    ]);
    const result = await svc.markAddressCompromised({
      depositAddressId: 'addr-1', actorId: 'admin-1',
      reason: 'key leaked in support ticket', correlationId: 'corr-1',
    });
    expect(result.status).toBe('COMPROMISED');
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('ADDRESS_COMPROMISED');
    expect(auditLogs[0].actorId).toBe('admin-1');
    expect(auditLogs[0].correlationId).toBe('corr-1');
    const json = JSON.stringify(auditLogs[0]);
    expect(json.toLowerCase()).not.toContain('mnemonic');
    expect(json.toLowerCase()).not.toContain('privatekey');
  });

  it('markAddressCompromised: unknown address → NotFound (no audit write)', async () => {
    const { svc, auditLogs } = makeEmergencyService();
    await expect(
      svc.markAddressCompromised({
        depositAddressId: 'missing', actorId: 'admin-1', reason: 'test',
      }),
    ).rejects.toThrow(/not found/i);
    expect(auditLogs.length).toBe(0);
  });

  it('LOCKDOWN: recovery address allocation DENIED and audited', async () => {
    const { svc, auditLogs } = makeEmergencyService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN' });
    await expect(
      svc.allocateRecoveryAddress({
        userId: 'u1', chainId: POLYGON_CHAIN_ID, orderId: 'o1',
        actorId: 'admin-1', reason: 'compromise recovery',
      }),
    ).rejects.toThrow(/custody state is CUSTODY_LOCKDOWN/i);
    expect(auditLogs[0].action).toBe('ADDRESS_RECOVERY');
    expect(auditLogs[0].result).toBe('DENIED_LOCKDOWN');
  });

  it('NORMAL: recovery address allocated with CURRENT generation + audited', async () => {
    const { svc, auditLogs } = makeEmergencyService(
      { CUSTODY_GENERATION: '3' },
      [{ id: 'a0', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID, userId: 'u1',
         derivationIndex: 0, custodyGeneration: 1, status: DepositAddressStatus.COMPROMISED }],
    );
    const fresh = await svc.allocateRecoveryAddress({
      userId: 'u1', chainId: POLYGON_CHAIN_ID, orderId: 'o2',
      actorId: 'admin-1', reason: 'replace compromised addr',
    });
    expect(fresh.derivationIndex).toBe(1);
    expect(fresh.custodyGeneration).toBe(3);
    expect(auditLogs.some((l) => l.action === 'ADDRESS_RECOVERY' && l.result === 'SUCCESS')).toBe(true);
  });

  it('recordCustodyStateChange: audits intent, returns freshly-read state', async () => {
    const { svc, auditLogs } = makeEmergencyService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN' });
    const status = await svc.recordCustodyStateChange({
      action: 'CUSTODY_LOCKDOWN', actorId: 'admin-1', reason: 'seed compromise suspected',
    });
    expect(status.state).toBe(CustodyState.CUSTODY_LOCKDOWN);
    expect(auditLogs[0].action).toBe('CUSTODY_LOCKDOWN');
  });

  it('getCustodyStatus exposes only safe metadata (never secrets)', () => {
    const { svc } = makeEmergencyService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN', CUSTODY_GENERATION: '2' });
    const json = JSON.stringify(svc.getCustodyStatus());
    expect(json).not.toMatch(/mnemonic|privatekey|private_key|secret|seed/i);
    expect(JSON.parse(json)).toEqual({
      state: 'CUSTODY_LOCKDOWN', generation: 2,
      allocationAllowed: false, automaticSweepAllowed: false,
    });
  });

  it('generation bump does not overwrite old-generation records', async () => {
    const { svc, addresses } = makeEmergencyService(
      { CUSTODY_GENERATION: '2' },
      [{ id: 'old-gen', address: POLY_ADDR, chainId: POLYGON_CHAIN_ID, userId: 'u1',
         derivationIndex: 0, custodyGeneration: 1, status: DepositAddressStatus.ACTIVE }],
    );
    expect(addresses[0].custodyGeneration).toBe(1);
    const fresh = await svc.allocateRecoveryAddress({
      userId: 'u2', chainId: POLYGON_CHAIN_ID, orderId: 'o-new',
      actorId: 'admin-1', reason: 'post-compromise generation rollover',
    });
    expect(fresh.custodyGeneration).toBe(2);
    expect(addresses.find((a) => a.id === 'old-gen')?.custodyGeneration).toBe(1);
  });
});

// ============================================================
// 11-13. Sweep safety under custody state + compromised addresses
// ============================================================
describe('DepositSweepService — custody lockdown + compromised addresses', () => {
  function makeSweepService(
    env: Record<string, string> = {},
    sweep: any = null,
    opts: { compromised?: boolean } = {},
  ) {
    const sweepRow = sweep ?? {
      id: 'sw-1', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
      status: DepositSweepStatus.PENDING, destinationAddress: TREASURY,
      tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      amount: '10000000', sweepTxHash: null, signedTxRaw: null,
      depositAddressId: 'addr-1',
    };
    const sweepRepo: any = {
      findOne: jest.fn(async () => sweepRow),
      save: jest.fn(async (s: any) => s),
      find: jest.fn(async () => []),
      create: jest.fn((x: any) => x),
    };
    const depositRow = {
      id: 'd1', chainId: POLYGON_CHAIN_ID, depositAddress: POLY_ADDR,
      status: DepositStatus.COMPLETED, amount: '10000000', usdtAmount: '10',
    };
    const depositRepo: any = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => depositRow),
    };
    const dataSource: any = { query: jest.fn(async () => ({ rows: [] })) };
    const addressEntity = {
      id: 'addr-1', derivationIndex: 5,
    };
    const addressService: any = {
      isCompromised: jest.fn(async () => opts.compromised ?? false),
      findByAddressAndChainId: jest.fn(async () => addressEntity),
      isDevelopment: () => false,
    };
    const adapter: any = {
      getChainId: () => POLYGON_CHAIN_ID,
      getGasPrice: jest.fn(async () => 30n),
      getNativeBalance: jest.fn(async () => 10n ** 18n),
      getTokenBalance: jest.fn(async () => 100_000_000n),
      getNonce: jest.fn(async () => 7),
      sendRawTransaction: jest.fn(async () => TX),
      getTransactionReceipt: jest.fn(async () => null),
    };
    const chainRegistry: any = { getAdapter: () => adapter };
    const tokenRegistry: any = { getToken: () => ({ contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }) };
    const networkRegistry: any = {
      getNetworkByChainId: () => ({
        id: 'polygon', protocol: 'EVM', chainId: POLYGON_CHAIN_ID,
        usdtContract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        treasuryAddress: TREASURY,
      }),
    };
    const signer: any = {
      canSign: () => true,
      signTokenTransfer: jest.fn(async () => ({ signedTransaction: '0x' + 'ab'.repeat(80) })),
    };
    const gasFunding: any = { fundIfNeeded: jest.fn(async () => ({ funded: false })) };
    const configService: any = {
      get: (key: string) => {
        if (key === 'DEPOSIT_SWEEP_ENABLED') return 'true';
        if (key === 'GAS_SWEEP_GAS_LIMIT') return '100000';
        return env[key];
      },
    };
    const svc = new DepositSweepService(
      sweepRepo, depositRepo, dataSource, addressService, chainRegistry,
      tokenRegistry, networkRegistry, {} as any, {} as any,
      configService, signer, gasFunding, { add: jest.fn() } as any,
      { add: jest.fn() } as any,
    );
    return { svc, sweep: sweepRow, sweepRepo, adapter, addressService, depositRepo };
  }

  it('LOCKDOWN: scheduleDueSweeps returns 0 and does not query deposits', async () => {
    const { svc, depositRepo } = makeSweepService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN' });
    expect(await svc.scheduleDueSweeps()).toBe(0);
    expect(depositRepo.find).not.toHaveBeenCalled();
  });

  it('RECOVERY: scheduleDueSweeps returns 0 (no automatic sweeps)', async () => {
    const { svc, depositRepo } = makeSweepService({ CUSTODY_STATE: 'RECOVERY' });
    expect(await svc.scheduleDueSweeps()).toBe(0);
    expect(depositRepo.find).not.toHaveBeenCalled();
  });

  it('LOCKDOWN: PENDING sweep is NOT executed (no broadcast)', async () => {
    const { svc, sweep, adapter } = makeSweepService({ CUSTODY_STATE: 'CUSTODY_LOCKDOWN' });
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.PENDING);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('LOCKDOWN: mid-flight SUBMITTED sweep still confirms (state resolution)', async () => {
    const { svc, sweep, adapter } = makeSweepService(
      { CUSTODY_STATE: 'CUSTODY_LOCKDOWN' },
      { id: 'sw-2', depositId: 'd1', chainId: POLYGON_CHAIN_ID,
        status: DepositSweepStatus.SUBMITTED, destinationAddress: TREASURY,
        tokenAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        amount: '10000000', sweepTxHash: TX, signedTxRaw: null, depositAddressId: 'addr-1' },
    );
    adapter.getTransactionReceipt = jest.fn(async () => ({
      status: 1, blockNumber: 50_000_000, transactionHash: TX,
    }));
    await svc.executeSweep('sw-2');
    expect(sweep.status).toBe(DepositSweepStatus.COMPLETED);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('COMPROMISED source address: PENDING sweep → MANUAL_REVIEW, no broadcast', async () => {
    const { svc, sweep, adapter } = makeSweepService({}, null, { compromised: true });
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.MANUAL_REVIEW);
    expect(sweep.failureReason).toMatch(/COMPROMISED/i);
    expect(adapter.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('NORMAL + non-compromised: sweep proceeds normally', async () => {
    const { svc, sweep, adapter } = makeSweepService({});
    await svc.executeSweep('sw-1');
    expect(sweep.status).toBe(DepositSweepStatus.SUBMITTED);
    expect(adapter.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});