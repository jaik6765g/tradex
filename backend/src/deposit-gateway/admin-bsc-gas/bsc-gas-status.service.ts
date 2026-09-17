import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Deposit, DepositStatus } from '../../deposits/deposit.entity';
import { User } from '../../users/user.entity';
import {
  DepositAddress,
  DepositAddressStatus,
} from '../addresses/deposit-address.entity';
import { DepositSweep, DepositSweepStatus } from '../sweeps/deposit-sweep.entity';
import { ChainRegistryService } from '../chains/chain-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import {
  CUSTODY_GENERATION_ENV_KEY,
  normalizeCustodyGeneration,
} from '../custody/custody-state';

export const BSC_CHAIN_ID = 56;
export const SELF_CUSTODY_PROVIDERS = ['self_custody', 'self_custody_hd'];

export type BscGasOpStatus =
  | 'NO_USDT'
  | 'READY'
  | 'GAS_REQUIRED'
  | 'SWEEPING'
  | 'COMPLETED'
  | 'MANUAL_REVIEW';

export interface BscGasRow {
  depositAddressId: string;
  userId: string | null;
  userEmail: string | null;
  userMobile: string | null;
  depositAddress: string;
  network: string;
  chainId: number;
  derivationIndex: number | null;
  derivationPath: string | null;
  custodyGeneration: number;
  provider: string | null;
  bnbBalance: string;
  bnbBalanceWei: string;
  usdtBalance: string;
  usdtBalanceRaw: string;
  requiredGasBnb: string;
  requiredGasWei: string;
  gasShortfallBnb: string;
  gasShortfallWei: string;
  recommendedBnb: string;
  recommendedWei: string;
  gasPriceWei: string;
  sweepStatus: string | null;
  sweepId: string | null;
  depositStatus: string | null;
  opStatus: BscGasOpStatus;
  eligibleForTopUp: boolean;
  eligibleForSweep: boolean;
  treasury: string;
  updatedAt: string;
}

export function weiToBnb(wei: bigint): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '.0');
}

export function bnbToWei(bnb: string): bigint {
  const [w = '0', f = ''] = bnb.split('.');
  const frac = (f + '0'.repeat(18)).slice(0, 18);
  return BigInt(w || '0') * 10n ** 18n + BigInt(frac || '0');
}

export function formatToken(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return whole.toString() + (frac ? '.' + frac : '.0');
}
@Injectable()
export class BscGasStatusService {
  private readonly logger = new Logger(BscGasStatusService.name);

  constructor(
    @InjectRepository(DepositAddress)
    private readonly addressRepo: Repository<DepositAddress>,
    @InjectRepository(Deposit)
    private readonly depositRepo: Repository<Deposit>,
    @InjectRepository(DepositSweep)
    private readonly sweepRepo: Repository<DepositSweep>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly chainRegistry: ChainRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly configService: ConfigService,
  ) {}

  gasLimit(): bigint {
    try {
      return BigInt(this.configService.get<string>('DEPOSIT_SWEEP_GAS_LIMIT') ?? '100000');
    } catch {
      return 100000n;
    }
  }

  safetyBufferWei(): bigint {
    const raw = (this.configService.get<string>('BSC_GAS_SAFETY_BUFFER_BNB') ?? '0.0005').trim();
    try {
      return bnbToWei(raw);
    } catch {
      return bnbToWei('0.0005');
    }
  }

  treasury(): string {
    try {
      const n = this.networkRegistry.getNetwork('bsc');
      return (n.treasuryAddress || '').trim();
    } catch {
      return (this.configService.get<string>('BSC_TREASURY_ADDRESS') ?? '').trim();
    }
  }

  currentGeneration(): number {
    return normalizeCustodyGeneration(
      this.configService.get<string>(CUSTODY_GENERATION_ENV_KEY),
    );
  }

  private adapterOrNull(): any {
    try {
      return this.chainRegistry.getAdapter(BSC_CHAIN_ID);
    } catch {
      return null;
    }
  }

  private usdtContract(): string {
    try {
      return this.networkRegistry.getNetwork('bsc').usdtContract;
    } catch {
      return '0x55d398326f99059fF775485246999027B3197955';
    }
  }

  private usdtDecimals(): number {
    try {
      return this.networkRegistry.getNetwork('bsc').usdtDecimals;
    } catch {
      return 18;
    }
  }

  async listOperationalAddresses(): Promise<DepositAddress[]> {
    return this.addressRepo.find({
      where: {
        chainId: BSC_CHAIN_ID,
        status: DepositAddressStatus.ACTIVE,
        provider: In(SELF_CUSTODY_PROVIDERS),
      },
    });
  }
  async buildRow(addr: DepositAddress): Promise<BscGasRow> {
    const treasury = this.treasury();
    const adapter = this.adapterOrNull();
    const gasLimit = this.gasLimit();
    const bufferWei = this.safetyBufferWei();
    let gasPriceWei = 0n;
    let bnbWei = 0n;
    let usdtRaw = 0n;
    let chainError: string | null = null;
    if (!adapter) {
      chainError = 'BSC adapter unavailable (RPC not configured)';
    } else {
      try {
        gasPriceWei = await adapter.getGasPrice();
        if (gasPriceWei <= 0n) gasPriceWei = 1n;
      } catch (e) {
        chainError = 'gas price read failed: ' + (e as Error).message;
        gasPriceWei = 1n;
      }
      try {
        bnbWei = await adapter.getNativeBalance(addr.address);
      } catch (e) {
        chainError = 'native balance read failed: ' + (e as Error).message;
      }
      try {
        if (typeof adapter.getTokenBalance === 'function') {
          usdtRaw = await adapter.getTokenBalance(this.usdtContract(), addr.address);
        }
      } catch (e) {
        chainError = 'token balance read failed: ' + (e as Error).message;
      }
    }
    const requiredWei = gasLimit * (gasPriceWei > 0n ? gasPriceWei : 1n) + bufferWei;
    const shortfallWei = bnbWei >= requiredWei ? 0n : requiredWei - bnbWei;
    const recommendedWei = shortfallWei > 0n ? shortfallWei + bufferWei : 0n;
    const deposits = await this.depositRepo.find({
      where: {
        depositAddress: addr.address,
        chainId: BSC_CHAIN_ID,
        status: In([DepositStatus.VERIFIED, DepositStatus.COMPLETED]),
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const latestDeposit = deposits[0] ?? null;
    let latestSweep: DepositSweep | null = null;
    if (latestDeposit) {
      latestSweep = await this.sweepRepo.findOne({ where: { depositId: latestDeposit.id } });
    }
    let opStatus: BscGasOpStatus;
    if (chainError) {
      opStatus = 'MANUAL_REVIEW';
    } else if (
      latestSweep &&
      ['PENDING', 'BROADCASTING', 'SUBMITTED', 'CONFIRMING'].includes(latestSweep.status)
    ) {
      opStatus = 'SWEEPING';
    } else if (usdtRaw <= 0n) {
      opStatus = latestSweep?.status === DepositSweepStatus.COMPLETED ? 'COMPLETED' : 'NO_USDT';
    } else if (bnbWei >= requiredWei) {
      opStatus = 'READY';
    } else {
      opStatus = 'GAS_REQUIRED';
    }
    if (treasury && addr.address.toLowerCase() === treasury.toLowerCase()) {
      opStatus = 'MANUAL_REVIEW';
    } else if (addr.custodyGeneration !== this.currentGeneration()) {
      opStatus = 'MANUAL_REVIEW';
    }
    let userEmail: string | null = null;
    let userMobile: string | null = null;
    if (addr.userId) {
      try {
        const u = await this.userRepo.findOne({ where: { id: addr.userId } });
        userEmail = u?.email ?? null;
        userMobile = u?.mobileNumber ?? null;
      } catch { /* never fail row on user lookup */ }
    }
    const eligibleForTopUp = opStatus === 'GAS_REQUIRED';
    const eligibleForSweep =
      opStatus === 'READY' &&
      !!latestDeposit &&
      (!latestSweep ||
        latestSweep.status === DepositSweepStatus.GAS_REQUIRED ||
        latestSweep.status === DepositSweepStatus.PENDING);
    return {
      depositAddressId: addr.id,
      userId: addr.userId,
      userEmail,
      userMobile,
      depositAddress: addr.address,
      network: 'bsc',
      chainId: BSC_CHAIN_ID,
      derivationIndex: addr.derivationIndex,
      derivationPath: addr.derivationPath,
      custodyGeneration: addr.custodyGeneration,
      provider: addr.provider,
      bnbBalance: weiToBnb(bnbWei),
      bnbBalanceWei: bnbWei.toString(),
      usdtBalance: formatToken(usdtRaw, this.usdtDecimals()),
      usdtBalanceRaw: usdtRaw.toString(),
      requiredGasBnb: weiToBnb(requiredWei),
      requiredGasWei: requiredWei.toString(),
      gasShortfallBnb: weiToBnb(shortfallWei),
      gasShortfallWei: shortfallWei.toString(),
      recommendedBnb: weiToBnb(recommendedWei),
      recommendedWei: recommendedWei.toString(),
      gasPriceWei: gasPriceWei.toString(),
      sweepStatus: latestSweep?.status ?? null,
      sweepId: latestSweep?.id ?? null,
      depositStatus: latestDeposit?.status ?? null,
      opStatus,
      eligibleForTopUp,
      eligibleForSweep,
      treasury,
      updatedAt: new Date().toISOString(),
    };
  }

  async listRows(): Promise<BscGasRow[]> {
    const addrs = await this.listOperationalAddresses();
    const rows: BscGasRow[] = [];
    for (const a of addrs) {
      try {
        rows.push(await this.buildRow(a));
      } catch (e) {
        this.logger.warn('BSC gas row failed for ' + a.address + ': ' + (e as Error).message);
      }
    }
    return rows;
  }

  toCsv(rows: BscGasRow[]): string {
    const header = [
      'user_id', 'deposit_address', 'network', 'chain_id', 'usdt_balance',
      'bnb_balance', 'required_gas', 'gas_shortfall', 'recommended_bnb', 'sweep_status',
    ].join(',');
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = rows.map((r) =>
      [
        r.userId ?? '', r.depositAddress, r.network, r.chainId, r.usdtBalance,
        r.bnbBalance, r.requiredGasBnb, r.gasShortfallBnb, r.recommendedBnb,
        r.sweepStatus ?? r.opStatus,
      ].map(esc).join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }
}
