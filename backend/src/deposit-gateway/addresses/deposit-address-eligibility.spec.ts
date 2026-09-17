import { DepositAddressService } from './deposit-address.service';
import { DepositAddressStatus } from './deposit-address.entity';
import { DepositOrderStatus } from '../orders/deposit-order.entity';
import type { ConfigService } from '@nestjs/config';

const BSC_CHAIN_ID = 56;
const BSC_ADDR_0 = '0xBbB00000000000000000000000000000000000000';
const BSC_ADDR_1 = '0xBbB11111111111111111111111111111111111111';

/**
 * Harness that mimics the real repository/manager for DepositAddressService.
 * The provider is fully deterministic so derivable-eligibility checks behave
 * like the real self-custody provider (BSC chain only in these tests).
 */
function makeHarness(
  env: Record<string, string> = {},
  existing: any = null,
  providerName = 'self_custody',
) {
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
    name: providerName,
    isDevelopment: () => false,
    generateAddress: jest.fn((inp: any) => ({
      address:
        inp.derivationIndex === 0 ? BSC_ADDR_0 : BSC_ADDR_1,
      chainId: inp.chainId,
      provider: providerName,
      derivationIndex: inp.derivationIndex,
      derivationPath: `m/44'/60'/0'/0/${inp.derivationIndex}`,
      metadata: { custody: 'self' },
    })),
    validateAddress: () => true,
    getAddressMetadata: () => ({}),
  };
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const svc = new DepositAddressService(
    repo as any,
    dataSource,
    provider,
    configService,
  );
  const manager: any = {
    getRepository: () => repo,
    query: dataSource.query,
  };
  (svc as any).manager = manager;
  return { svc, repo, addresses, provider, manager };
}
describe('DepositAddressService — address eligibility (legacy reuse fix)', () => {
  it('EXPIRED legacy address is NOT returned — fresh ACTIVE address allocated', async () => {
    const legacy = {
      id: 'legacy-1',
      address: '0x9999999999999999999999999999999999999999',
      chainId: BSC_CHAIN_ID,
      userId: 'user-1',
      orderId: 'order-1',
      provider: null,
      derivationIndex: null,
      derivationPath: null,
      custodyGeneration: 1,
      status: DepositAddressStatus.EXPIRED,
    };
    const { svc } = makeHarness({}, legacy);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-1',
      orderId: 'order-2',
    });
    expect(allocated.status).toBe(DepositAddressStatus.ACTIVE);
    expect(allocated.address).not.toBe(legacy.address);
    expect(allocated.provider).toBe('self_custody');
    expect(allocated.derivationIndex).not.toBeNull();
    expect(allocated.derivationPath).not.toBeNull();
  });

  it('EXPIRED legacy address open orders are cancelled', async () => {
    const legacy = {
      id: 'legacy-2',
      address: '0x9999999999999999999999999999999999999998',
      chainId: BSC_CHAIN_ID,
      userId: 'user-2',
      orderId: 'order-old',
      provider: null,
      derivationIndex: null,
      derivationPath: null,
      custodyGeneration: 1,
      status: DepositAddressStatus.EXPIRED,
    };
    const { svc, repo } = makeHarness({}, legacy);
    await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-2',
      orderId: 'order-new',
    });
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ depositAddressId: 'legacy-2' }),
      { status: DepositOrderStatus.CANCELLED },
    );
  });

  it('provider=NULL ACTIVE address is NOT reused for self-custody', async () => {
    const legacy = {
      id: 'legacy-3',
      address: '0x9999999999999999999999999999999999999997',
      chainId: BSC_CHAIN_ID,
      userId: 'user-3',
      orderId: 'order-1',
      provider: null,
      derivationIndex: 0,
      derivationPath: 'dev/56/0',
      custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    };
    const { svc, addresses } = makeHarness({}, legacy);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-3',
      orderId: 'order-2',
    });
    expect(allocated.provider).toBe('self_custody');
    expect(allocated.status).toBe(DepositAddressStatus.ACTIVE);
    expect(allocated.address).not.toBe(legacy.address);
    expect(addresses.find((a) => a.id === 'legacy-3')?.derivationIndex).toBe(0);
  });

  it('missing derivation_index is NEVER reusable', async () => {
    const broken = {
      id: 'broken-index',
      address: '0x9999999999999999999999999999999999999996',
      chainId: BSC_CHAIN_ID,
      userId: 'user-4',
      orderId: 'order-1',
      provider: 'self_custody',
      derivationIndex: null,
      derivationPath: `m/44'/60'/0'/0/0`,
      custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    };
    const { svc } = makeHarness({}, broken);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-4',
      orderId: 'order-2',
    });
    expect(allocated.derivationIndex).not.toBeNull();
    expect(allocated.id).not.toBe('broken-index');
  });

  it('missing derivation_path is NEVER reusable', async () => {
    const broken = {
      id: 'broken-path',
      address: '0x9999999999999999999999999999999999999995',
      chainId: BSC_CHAIN_ID,
      userId: 'user-5',
      orderId: 'order-1',
      provider: 'self_custody',
      derivationIndex: 0,
      derivationPath: null as string | null,
      custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    };
    const { svc } = makeHarness({}, broken);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-5',
      orderId: 'order-2',
    });
    expect(allocated.derivationPath).not.toBeNull();
    expect(allocated.id).not.toBe('broken-path');
  });
it('ALLOWS reuse of a healthy ACTIVE self-custody address (permanent address)', async () => {
    const healthy = {
      id: 'healthy-1',
      address: BSC_ADDR_0,
      chainId: BSC_CHAIN_ID,
      userId: 'user-7',
      orderId: 'order-1',
      provider: 'self_custody',
      derivationIndex: 0,
      derivationPath: `m/44'/60'/0'/0/0`,
      custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    };
    const { svc, addresses } = makeHarness({}, healthy);
    const reused = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-7',
      orderId: 'order-2',
    });
    expect(reused.id).toBe('healthy-1');
    expect(reused.address).toBe(BSC_ADDR_0);
    expect(addresses.length).toBe(1);
  });

  it('fresh self-custody address records carry derivation metadata + generation', async () => {
    const { svc, addresses } = makeHarness({}, null);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-8',
      orderId: 'order-1',
    });
    expect(allocated.provider).toBe('self_custody');
    expect(allocated.status).toBe(DepositAddressStatus.ACTIVE);
    expect(allocated.derivationIndex).toBe(0);
    expect(allocated.derivationPath).toBe(`m/44'/60'/0'/0/0`);
    expect(allocated.custodyGeneration).toBe(1);
    expect(addresses.length).toBe(1);
  });

  it('existing index-0 address is NOT reassigned to another user', async () => {
    const occupant = {
      id: 'index0-userA',
      address: BSC_ADDR_0,
      chainId: BSC_CHAIN_ID,
      userId: 'user-A',
      orderId: 'order-A',
      provider: 'self_custody',
      derivationIndex: 0,
      derivationPath: `m/44'/60'/0'/0/0`,
      custodyGeneration: 1,
      status: DepositAddressStatus.ACTIVE,
    };
    const { svc } = makeHarness({}, occupant);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-B',
      orderId: 'order-B',
    });
    expect(allocated.derivationIndex).toBe(1);
    expect(allocated.address).not.toBe(BSC_ADDR_0);
  });

  it('derived address colliding with configured treasury is skipped', async () => {
    const { svc } = makeHarness(
      { DEPOSIT_TREASURY_ADDRESS: BSC_ADDR_0 },
      null,
    );
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-T',
      orderId: 'order-T',
    });
    expect(allocated.address).not.toBe(BSC_ADDR_0);
    expect(allocated.derivationIndex).toBe(1);
  });

  it('frontend cannot bypass: stale legacy row still yields a fresh address', async () => {
    const legacy = {
      id: 'stale',
      address: '0x9999999999999999999999999999999999999993',
      chainId: BSC_CHAIN_ID,
      userId: 'user-F',
      orderId: 'order-1',
      provider: null,
      derivationIndex: null,
      derivationPath: null,
      custodyGeneration: 1,
      status: DepositAddressStatus.EXPIRED,
    };
    const { svc, addresses } = makeHarness({}, legacy);
    const allocated = await svc.allocateWithManager((svc as any).manager, {
      chainId: BSC_CHAIN_ID,
      userId: 'user-F',
      orderId: 'order-F',
    });
    expect(allocated.status).toBe(DepositAddressStatus.ACTIVE);
    expect(allocated.provider).toBe('self_custody');
    expect(allocated.address).not.toBe(legacy.address);
    expect(addresses.some((a) => a.address === legacy.address)).toBe(true);
  });
});