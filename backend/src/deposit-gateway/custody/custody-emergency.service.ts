import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DepositAddress, DepositAddressStatus } from '../addresses/deposit-address.entity';
import { CustodyAuditLog } from './custody-audit-log.entity';
import {
  CustodyState,
  CUSTODY_STATE_ENV_KEY,
  CUSTODY_GENERATION_ENV_KEY,
  isAllocationAllowed,
  normalizeCustodyGeneration,
  normalizeCustodyState,
} from './custody-state';

export interface CustodyStatus {
  state: CustodyState;
  generation: number;
  allocationAllowed: boolean;
  automaticSweepAllowed: boolean;
}

/**
 * Custody emergency operations (TradeX Custody Hardening).
 * All operations are audited (custody_audit_logs) and return ONLY safe
 * metadata -- never secrets. The master seed is never touched here.
 */
@Injectable()
export class CustodyEmergencyService {
  private readonly logger = new Logger(CustodyEmergencyService.name);

  constructor(
    @InjectRepository(DepositAddress)
    private readonly addressRepo: Repository<DepositAddress>,
    @InjectRepository(CustodyAuditLog)
    private readonly auditRepo: Repository<CustodyAuditLog>,
    private readonly configService: ConfigService,
  ) {}

  getCustodyStatus(): CustodyStatus {
    const state = normalizeCustodyState(this.configService.get<string>(CUSTODY_STATE_ENV_KEY));
    const generation = normalizeCustodyGeneration(
      this.configService.get<string>(CUSTODY_GENERATION_ENV_KEY),
    );
    return {
      state,
      generation,
      allocationAllowed: state === CustodyState.NORMAL,
      automaticSweepAllowed: state === CustodyState.NORMAL,
    };
  }

  /**
   * Mark a single derived deposit address as COMPROMISED.
   * Effects: status -> COMPROMISED, not reused, sweep suppressed, history
   * preserved. Master seed is NOT rotated.
   */
  async markAddressCompromised(input: {
    depositAddressId: string;
    actorId: string;
    reason: string;
    correlationId?: string;
  }): Promise<{ id: string; address: string; status: string }> {
    const addr = await this.addressRepo.findOne({ where: { id: input.depositAddressId } });
    if (!addr) throw new NotFoundException('Deposit address not found');

    addr.status = DepositAddressStatus.COMPROMISED;
    await this.addressRepo.save(addr);

    await this.audit({
      actorId: input.actorId,
      action: 'ADDRESS_COMPROMISED',
      network: networkForChainId(addr.chainId),
      address: addr.address,
      depositAddressId: addr.id,
      custodyGeneration: addr.custodyGeneration,
      reason: input.reason,
      result: 'SUCCESS',
      correlationId: input.correlationId,
    });

    this.logger.warn(
      `Custody: address ${addr.address} (chain ${addr.chainId}) marked COMPROMISED by ${input.actorId}: ${input.reason}`,
    );
    return { id: addr.id, address: addr.address, status: addr.status };
  }

  /**
   * Allocate a fresh recovery address (next derivation index, current
   * custody generation) to replace a compromised one. Requires NORMAL state.
   */
  async allocateRecoveryAddress(input: {
    userId: string;
    chainId: number;
    orderId: string;
    actorId: string;
    reason: string;
    correlationId?: string;
  }): Promise<DepositAddress> {
    const status = this.getCustodyStatus();
    if (!status.allocationAllowed) {
      await this.audit({
        actorId: input.actorId,
        action: 'ADDRESS_RECOVERY',
        network: networkForChainId(input.chainId),
        reason: input.reason,
        result: 'DENIED_LOCKDOWN',
        correlationId: input.correlationId,
        metadata: { state: status.state },
      });
      throw new Error(`Address allocation denied: custody state is ${status.state}`);
    }

    const row = await this.addressRepo
      .createQueryBuilder('a')
      .select('MAX(a.derivationIndex)', 'max')
      .where('a.chainId = :chainId', { chainId: input.chainId })
      .getRawOne<{ max: number | null }>();
    const nextIndex = (row?.max ?? -1) + 1;

    const entity = this.addressRepo.create({
      address: `RECOVERY_PENDING_${input.chainId}_${nextIndex}`,
      chainId: input.chainId,
      userId: input.userId,
      orderId: input.orderId,
      provider: 'self_custody_hd',
      derivationIndex: nextIndex,
      derivationPath: `m/44'/60'/0'/0/${nextIndex}`,
      custodyGeneration: status.generation,
      status: DepositAddressStatus.ACTIVE,
    });
    const saved = await this.addressRepo.save(entity);

    await this.audit({
      actorId: input.actorId,
      action: 'ADDRESS_RECOVERY',
      network: networkForChainId(input.chainId),
      address: saved.address,
      depositAddressId: saved.id,
      custodyGeneration: saved.custodyGeneration,
      reason: input.reason,
      result: 'SUCCESS',
      correlationId: input.correlationId,
      metadata: { derivationIndex: nextIndex },
    });
    return saved;
  }

  /**
   * Audit a declared global custody state change. The actual state change is
   * an out-of-band config operation (CUSTODY_STATE env) -- config is the
   * source of truth. This method records operator intent and returns the
   * freshly-read state. It does NOT mutate config.
   */
  async recordCustodyStateChange(input: {
    action: 'CUSTODY_LOCKDOWN' | 'CUSTODY_RECOVERY' | 'CUSTODY_NORMAL';
    actorId: string;
    reason: string;
    correlationId?: string;
  }): Promise<CustodyStatus> {
    const current = this.getCustodyStatus();
    await this.audit({
      actorId: input.actorId,
      action: input.action,
      reason: input.reason,
      result: 'RECORDED',
      correlationId: input.correlationId,
      metadata: { observedState: current.state, generation: current.generation },
    });
    this.logger.warn(
      `Custody: operator ${input.actorId} recorded ${input.action} (current state=${current.state}): ${input.reason}`,
    );
    return current;
  }

  async listAuditLogs(limit = 100): Promise<CustodyAuditLog[]> {
    return this.auditRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(limit, 500)),
    });
  }

  private async audit(entry: {
    actorId: string;
    action: string;
    network?: string | null;
    address?: string | null;
    depositAddressId?: string | null;
    custodyGeneration?: number | null;
    reason?: string | null;
    result: string;
    correlationId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const log = this.auditRepo.create({ ...entry, metadata: entry.metadata ?? {} });
    await this.auditRepo.save(log);
  }
}

function networkForChainId(chainId: number): string {
  if (chainId === 56) return 'bsc';
  if (chainId === 1) return 'ethereum';
  if (chainId === 137) return 'polygon';
  if (chainId === 42161) return 'arbitrum';
  return `chain_${chainId}`;
}