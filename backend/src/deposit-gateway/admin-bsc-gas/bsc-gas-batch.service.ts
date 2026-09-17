import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';

import {
  DepositAddress,
  DepositAddressStatus,
} from '../addresses/deposit-address.entity';
import { BscGasBatch, BscGasBatchStatus } from './entities/bsc-gas-batch.entity';
import { BscGasTransfer, BscGasTransferStatus } from './entities/bsc-gas-transfer.entity';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { CustodyAuditLog } from '../custody/custody-audit-log.entity';
import { ChainRegistryService } from '../chains/chain-registry.service';
import { NetworkRegistryService } from '../networks/network-registry.service';
import { DepositSweepService } from '../sweeps/deposit-sweep.service';
import { BscGasWalletService } from './bsc-gas-wallet.service';
import {
  BSC_CHAIN_ID,
  BscGasStatusService,
  SELF_CUSTODY_PROVIDERS,
  weiToBnb,
} from './bsc-gas-status.service';

export interface PreviewRecipient {
  depositAddressId: string | null;
  address: string;
  ok: boolean;
  rejectReason: string | null;
  currentBnb: string;
  requiredGasBnb: string;
  shortfallBnb: string;
  fundingBnb: string;
  fundingWei: string;
}

const NATIVE_TRANSFER_GAS_LIMIT = 21000n;

function checksum(addr: string): string | null {
  try {
    return ethers.getAddress(addr);
  } catch {
    return null;
  }
}
@Injectable()
export class BscGasBatchService {
  private readonly logger = new Logger(BscGasBatchService.name);

  constructor(
    @InjectRepository(DepositAddress)
    private readonly addressRepo: Repository<DepositAddress>,
    @InjectRepository(BscGasBatch)
    private readonly batchRepo: Repository<BscGasBatch>,
    @InjectRepository(BscGasTransfer)
    private readonly transferRepo: Repository<BscGasTransfer>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditRepo: Repository<AdminAuditLog>,
    @InjectRepository(CustodyAuditLog)
    private readonly custodyAuditRepo: Repository<CustodyAuditLog>,
    private readonly statusService: BscGasStatusService,
    private readonly gasWallet: BscGasWalletService,
    private readonly chainRegistry: ChainRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly sweepService: DepositSweepService,
    private readonly configService: ConfigService,
  ) {}

  private requiredConfirmations(): number {
    try {
      return this.networkRegistry.getNetwork('bsc').confirmations;
    } catch {
      return 15;
    }
  }

  private treasury(): string {
    return this.statusService.treasury();
  }

  private normalizeRecipients(input: string[]): string[] {
    const out: string[] = [];
    for (const r of input ?? []) {
      const t = String(r ?? '').trim();
      if (t) out.push(t);
    }
    return out;
  }

  /** Full batch-send safety validation (spec section 5). Never throws away detail. */
  async validateRecipients(
    recipients: string[],
    opts: { allowZeroUsdt?: boolean } = {},
  ): Promise<{ items: PreviewRecipient[]; totalWei: bigint }> {
    const list = this.normalizeRecipients(recipients);
    if (list.length === 0) throw new BadRequestException('At least one recipient is required');
    if (list.length > 50) throw new BadRequestException('Too many recipients (max 50)');
    const treasury = this.treasury();
    const generation = this.statusService.currentGeneration();
    const seen = new Set<string>();
    const items: PreviewRecipient[] = [];
    let totalWei = 0n;
    for (const raw of list) {
      const fail = (reason: string): PreviewRecipient => ({
        depositAddressId: null, address: raw, ok: false, rejectReason: reason,
        currentBnb: '0.0', requiredGasBnb: '0.0', shortfallBnb: '0.0',
        fundingBnb: '0.0', fundingWei: '0',
      });
      const cs = checksum(raw);
      if (!cs) { items.push(fail('INVALID_ADDRESS')); continue; }
      const key = cs.toLowerCase();
      if (seen.has(key)) { items.push(fail('DUPLICATE_RECIPIENT')); continue; }
      seen.add(key);
      if (treasury && key === treasury.toLowerCase()) { items.push(fail('TREASURY_ADDRESS')); continue; }
      let addr: DepositAddress | null = null;
      try {
        addr = await this.addressRepo.findOne({ where: { address: raw, chainId: BSC_CHAIN_ID } });
        if (!addr) addr = await this.addressRepo.findOne({ where: { address: cs, chainId: BSC_CHAIN_ID } });
      } catch { addr = null; }
      if (!addr) { items.push(fail('UNKNOWN_ADDRESS')); continue; }
      if (addr.chainId !== BSC_CHAIN_ID) { items.push(fail('WRONG_CHAIN')); continue; }
      if (!addr.provider || !SELF_CUSTODY_PROVIDERS.includes(addr.provider)) { items.push(fail('LEGACY_PROVIDER_NULL')); continue; }
      if (addr.status === DepositAddressStatus.COMPROMISED) { items.push(fail('COMPROMISED')); continue; }
      if (addr.status === DepositAddressStatus.EXPIRED) { items.push(fail('EXPIRED')); continue; }
      if (addr.status === DepositAddressStatus.RELEASED) { items.push(fail('RELEASED')); continue; }
      if (addr.status !== DepositAddressStatus.ACTIVE) { items.push(fail('NOT_ACTIVE')); continue; }
      if (addr.derivationIndex === null || !Number.isInteger(addr.derivationIndex) || (addr.derivationIndex as number) < 0) { items.push(fail('MISSING_DERIVATION_INDEX')); continue; }
      if (!addr.derivationPath) { items.push(fail('MISSING_DERIVATION_PATH')); continue; }
      if (addr.custodyGeneration !== generation) { items.push(fail('STALE_GENERATION')); continue; }
      const row = await this.statusService.buildRow(addr);
      if (row.opStatus === 'MANUAL_REVIEW') { items.push({ depositAddressId: addr.id, address: cs, ok: false, rejectReason: 'MANUAL_REVIEW', currentBnb: row.bnbBalance, requiredGasBnb: row.requiredGasBnb, shortfallBnb: row.gasShortfallBnb, fundingBnb: '0.0', fundingWei: '0' }); continue; }
      const usdtZero = BigInt(row.usdtBalanceRaw) <= 0n;
      if (usdtZero && !opts.allowZeroUsdt) { items.push({ depositAddressId: addr.id, address: cs, ok: false, rejectReason: 'NO_USDT_OVERRIDE_REQUIRED', currentBnb: row.bnbBalance, requiredGasBnb: row.requiredGasBnb, shortfallBnb: row.gasShortfallBnb, fundingBnb: '0.0', fundingWei: '0' }); continue; }
      const fundingWei = BigInt(row.recommendedWei);
      if (fundingWei <= 0n) { items.push({ depositAddressId: addr.id, address: cs, ok: false, rejectReason: 'NO_SHORTFALL', currentBnb: row.bnbBalance, requiredGasBnb: row.requiredGasBnb, shortfallBnb: row.gasShortfallBnb, fundingBnb: '0.0', fundingWei: '0' }); continue; }
      totalWei += fundingWei;
      items.push({
        depositAddressId: addr.id, address: cs, ok: true, rejectReason: null,
        currentBnb: row.bnbBalance, requiredGasBnb: row.requiredGasBnb,
        shortfallBnb: row.gasShortfallBnb, fundingBnb: row.recommendedBnb, fundingWei: fundingWei.toString(),
      });
    }
    return { items, totalWei };
  }

  async preview(recipients: string[], opts: { allowZeroUsdt?: boolean } = {}) {
    const { items, totalWei } = await this.validateRecipients(recipients, opts);
    const eligible = items.filter((i) => i.ok);
    const rejected = items.filter((i) => !i.ok);
    const idempotencyKey = randomUUID();
    const treasury = this.treasury();
    return {
      idempotencyKey,
      network: 'bsc',
      chainId: BSC_CHAIN_ID,
      gasWallet: this.gasWallet.getAddress(),
      gasWalletConfigured: this.gasWallet.isConfigured(),
      treasury,
      recipientCount: eligible.length,
      totalBnb: weiToBnb(totalWei),
      totalWei: totalWei.toString(),
      eligible,
      rejected,
    };
  }

  private async audit(adminId: string | null, action: string, metadata: Record<string, unknown>) {
    try {
      const row = this.adminAuditRepo.create({
        adminId: adminId ?? '00000000-0000-0000-0000-000000000000',
        action, targetType: 'bsc_gas_batch', targetId: String(metadata['batchId'] ?? ''),
        oldValue: null, newValue: null, ipAddress: null, userAgent: null, metadata,
      } as any);
      await this.adminAuditRepo.save(row as any);
    } catch { /* audit never breaks ops */ }
    try {
      const c = this.custodyAuditRepo.create({
        actorId: adminId, action,
        network: 'bsc', address: String(metadata['recipient'] ?? metadata['batchId'] ?? ''),
        reason: String(metadata['reason'] ?? action), result: String(metadata['result'] ?? 'SUCCESS'),
        correlationId: String(metadata['batchId'] ?? ''), metadata,
      } as any);
      await this.custodyAuditRepo.save(c as any);
    } catch { /* audit never breaks ops */ }
  }
  async send(input: { recipients: string[]; idempotencyKey: string; confirmed: boolean; allowZeroUsdt?: boolean }, adminId: string | null) {
    if (input.confirmed !== true) throw new BadRequestException('Explicit admin confirmation is required');
    const key = String(input.idempotencyKey ?? '').trim();
    if (!key) throw new BadRequestException('idempotencyKey is required');
    const existing = await this.batchRepo.findOne({ where: { idempotencyKey: key } });
    if (existing) {
      const transfers = await this.transferRepo.find({ where: { batchId: existing.id } });
      return { batch: existing, transfers, idempotent: true };
    }
    const { items, totalWei } = await this.validateRecipients(input.recipients, { allowZeroUsdt: input.allowZeroUsdt });
    const eligible = items.filter((i) => i.ok);
    const rejected = items.filter((i) => !i.ok);
    if (rejected.length > 0) {
      throw new BadRequestException({ message: 'Batch rejected: some recipients are ineligible', rejected });
    }
    if (eligible.length === 0) throw new BadRequestException('No eligible recipients');
    if (!this.gasWallet.isConfigured()) throw new BadRequestException('BSC gas wallet is not configured');
    const treasury = this.treasury();
    const gasAddr = this.gasWallet.getAddress() ?? '';
    if (treasury && gasAddr && gasAddr.toLowerCase() === treasury.toLowerCase()) {
      throw new BadRequestException('Gas wallet must not equal treasury');
    }
    let adapter: any = null;
    try { adapter = this.chainRegistry.getAdapter(BSC_CHAIN_ID); } catch { adapter = null; }
    if (!adapter) throw new BadRequestException('BSC adapter unavailable');
    const batch = await this.batchRepo.save(this.batchRepo.create({
      chainId: BSC_CHAIN_ID, status: BscGasBatchStatus.BROADCASTING,
      totalBnb: weiToBnb(totalWei), recipientCount: eligible.length,
      idempotencyKey: key, createdBy: adminId, gasWalletAddress: gasAddr,
    }));
    await this.audit(adminId, 'BSC_GAS_BATCH_CREATED', { batchId: batch.id, totalBnb: weiToBnb(totalWei), recipients: eligible.length, result: 'SUCCESS', reason: 'admin confirmed batch' });
    const transfers: BscGasTransfer[] = [];
    let gasPriceWei = 1n;
    try { gasPriceWei = await adapter.getGasPrice(); if (gasPriceWei <= 0n) gasPriceWei = 1n; } catch { gasPriceWei = 1n; }
    let nonce = 0;
    try { nonce = await adapter.getNonce(gasAddr); } catch { nonce = 0; }
    for (const item of eligible) {
      const amountWei = BigInt(item.fundingWei);
      let row = await this.transferRepo.findOne({ where: { batchId: batch.id, recipient: item.address } });
      if (!row) {
        row = await this.transferRepo.save(this.transferRepo.create({
          batchId: batch.id, recipient: item.address, amountBnb: item.fundingBnb,
          amountWei: amountWei.toString(), status: BscGasTransferStatus.BROADCASTING,
        }));
      }
      await this.audit(adminId, 'BSC_GAS_FUNDING_RECIPIENT', { batchId: batch.id, recipient: item.address, amountBnb: item.fundingBnb, result: 'SUCCESS', reason: 'batch send' });
      try {
        const signed = await this.gasWallet.signNativeTransfer({
          chainId: BSC_CHAIN_ID, to: item.address, amountWei,
          nonce, gasPriceWei, gasLimit: NATIVE_TRANSFER_GAS_LIMIT,
        });
        nonce += 1;
        let txHash: string;
        try {
          txHash = await adapter.sendRawTransaction(signed.signedTransaction);
        } catch (e) {
          row.status = BscGasTransferStatus.MANUAL_REVIEW;
          row.failureReason = 'Broadcast ambiguous: ' + (e as Error).message + ' (do NOT blindly resend)';
          await this.transferRepo.save(row);
          await this.audit(adminId, 'BSC_GAS_FUNDING_AMBIGUOUS', { batchId: batch.id, recipient: item.address, result: 'MANUAL_REVIEW', reason: row.failureReason });
          transfers.push(row);
          continue;
        }
        if (txHash && txHash.toLowerCase() !== signed.hash.toLowerCase()) {
          row.status = BscGasTransferStatus.MANUAL_REVIEW;
          row.failureReason = 'Broadcast hash mismatch expected ' + signed.hash + ' got ' + txHash;
          await this.transferRepo.save(row);
          transfers.push(row);
          continue;
        }
        row.txHash = txHash || signed.hash;
        row.status = BscGasTransferStatus.SUBMITTED;
        row.failureReason = null;
        await this.transferRepo.save(row);
        transfers.push(row);
        await this.audit(adminId, 'BSC_GAS_FUNDING_SUBMITTED', { batchId: batch.id, recipient: item.address, txHash: row.txHash, result: 'SUCCESS', reason: 'broadcast accepted' });
      } catch (e) {
        if (row.status === BscGasTransferStatus.BROADCASTING) {
          row.status = BscGasTransferStatus.FAILED;
          row.failureReason = (e as Error).message;
          await this.transferRepo.save(row);
        }
        transfers.push(row);
      }
    }
    const ok = transfers.filter((t) => t.status === BscGasTransferStatus.SUBMITTED);
    const bad = transfers.filter((t) => t.status !== BscGasTransferStatus.SUBMITTED);
    batch.status = bad.length === 0 ? BscGasBatchStatus.SUBMITTED : ok.length === 0 ? BscGasBatchStatus.FAILED : BscGasBatchStatus.PARTIAL;
    if (bad.length > 0) batch.failureReason = bad.length + ' transfer(s) need review';
    await this.batchRepo.save(batch);
    return { batch, transfers, idempotent: false };
  }

  async getBatch(id: string) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new BadRequestException('Batch not found');
    let transfers = await this.transferRepo.find({ where: { batchId: batch.id } });
    transfers = await this.refreshConfirmations(transfers);
    const confirmed = transfers.filter((t) => t.status === BscGasTransferStatus.CONFIRMED).length;
    const submitted = transfers.filter((t) => t.status === BscGasTransferStatus.SUBMITTED).length;
    if (confirmed === transfers.length && transfers.length > 0 && batch.status !== BscGasBatchStatus.CONFIRMED) {
      batch.status = BscGasBatchStatus.CONFIRMED;
      await this.batchRepo.save(batch);
    }
    const rechecked: Array<{ recipient: string; bnbBalance: string; opStatus: string; sweepReady: boolean }> = [];
    for (const t of transfers) {
      if (t.status !== BscGasTransferStatus.CONFIRMED) continue;
      const addr = await this.addressRepo.findOne({ where: { address: t.recipient, chainId: BSC_CHAIN_ID } });
      if (!addr) continue;
      try {
        const row = await this.statusService.buildRow(addr);
        rechecked.push({ recipient: t.recipient, bnbBalance: row.bnbBalance, opStatus: row.opStatus, sweepReady: row.eligibleForSweep });
      } catch { /* skip */ }
    }
    return {
      batch: {
        id: batch.id, chainId: batch.chainId, status: batch.status, totalBnb: batch.totalBnb,
        recipientCount: batch.recipientCount, gasWalletAddress: batch.gasWalletAddress,
        failureReason: batch.failureReason, createdAt: batch.createdAt, updatedAt: batch.updatedAt,
        confirmedCount: confirmed, submittedCount: submitted,
      },
      transfers: transfers.map((t) => ({
        id: t.id, recipient: t.recipient, amountBnb: t.amountBnb, txHash: t.txHash,
        status: t.status, blockNumber: t.blockNumber, confirmations: t.confirmations,
        failureReason: t.failureReason, createdAt: t.createdAt, confirmedAt: t.confirmedAt,
      })),
      rechecked,
      requiredConfirmations: this.requiredConfirmations(),
    };
  }

  private async refreshConfirmations(transfers: BscGasTransfer[]): Promise<BscGasTransfer[]> {
    let adapter: any = null;
    try { adapter = this.chainRegistry.getAdapter(BSC_CHAIN_ID); } catch { return transfers; }
    const need = this.requiredConfirmations();
    for (const t of transfers) {
      if (t.status !== BscGasTransferStatus.SUBMITTED || !t.txHash) continue;
      try {
        const receipt = await adapter.getTransactionReceipt(t.txHash);
        if (!receipt) continue;
        if (receipt.status === 0) {
          t.status = BscGasTransferStatus.FAILED;
          t.failureReason = 'Funding transaction reverted';
          await this.transferRepo.save(t);
          continue;
        }
        t.blockNumber = receipt.blockNumber;
        try { t.confirmations = await adapter.getConfirmations(receipt.blockNumber); }
        catch { t.confirmations = t.confirmations ?? 0; }
        if (t.confirmations >= need) {
          t.status = BscGasTransferStatus.CONFIRMED;
          t.confirmedAt = new Date();
          t.failureReason = null;
        }
        await this.transferRepo.save(t);
      } catch { /* keep SUBMITTED; retry on next poll */ }
    }
    return transfers;
  }

  /** Manual sweep trigger by sweep id — delegates to the EXISTING hardened DepositSweepService. */
  async executeSweepById(sweepId: string, adminId: string | null) {
    const sweep = await this.sweepService.getById(sweepId);
    if (sweep.chainId !== BSC_CHAIN_ID) throw new BadRequestException('Cross-network sweep refused (chainId must be 56)');
    if (sweep.depositAddressId) {
      return this.executeSweepForAddress(sweep.depositAddressId, adminId);
    }
    await this.audit(adminId, 'BSC_SWEEP_REQUESTED', { batchId: sweep.id, result: 'REQUESTED', reason: 'admin sweep click (no address link)' });
    await this.sweepService.executeSweep(sweep.id);
    const after = await this.sweepService.getById(sweep.id);
    return { sweepId: after.id, status: after.status, sweepTxHash: after.sweepTxHash, failureReason: after.failureReason, network: 'bsc', chainId: 56 };
  }

  async executeSweepForAddress(depositAddressId: string, adminId: string | null) {
    const addr = await this.addressRepo.findOne({ where: { id: depositAddressId } });
    if (!addr) throw new BadRequestException('Deposit address not found');
    if (addr.chainId !== BSC_CHAIN_ID) throw new BadRequestException('Cross-network sweep refused (chainId must be 56)');
    const row = await this.statusService.buildRow(addr);
    if (!row.eligibleForSweep || !row.sweepId) {
      throw new BadRequestException('Sweep not eligible: ' + row.opStatus + ' (backend is authoritative)');
    }
    await this.audit(adminId, 'BSC_SWEEP_REQUESTED', { batchId: row.sweepId, recipient: addr.address, result: 'REQUESTED', reason: 'admin sweep click' });
    await this.sweepService.executeSweep(row.sweepId);
    const after = await this.sweepService.getById(row.sweepId);
    const ok = after.status === 'COMPLETED' || after.status === 'SUBMITTED' || after.status === 'CONFIRMING';
    await this.audit(adminId, ok ? 'BSC_SWEEP_COMPLETED' : 'BSC_SWEEP_STATUS', { batchId: after.id, recipient: addr.address, result: after.status, reason: after.failureReason ?? '' });
    return {
      sweepId: after.id, status: after.status, sweepTxHash: after.sweepTxHash,
      failureReason: after.failureReason, source: addr.address, treasury: row.treasury,
      usdt: row.usdtBalance, bnb: row.bnbBalance, requiredGas: row.requiredGasBnb, network: 'bsc', chainId: 56,
    };
  }

  async bulkExecute(depositAddressIds: string[], adminId: string | null) {
    const ids = Array.from(new Set((depositAddressIds ?? []).map((s) => String(s ?? '').trim()).filter(Boolean))).slice(0, 50);
    const results: Array<{ depositAddressId: string; ok: boolean; sweepId?: string; status?: string; reason?: string }> = [];
    for (const id of ids) {
      try {
        const r = await this.executeSweepForAddress(id, adminId);
        results.push({ depositAddressId: id, ok: true, sweepId: r.sweepId, status: r.status });
      } catch (e) {
        results.push({ depositAddressId: id, ok: false, reason: (e as Error).message });
      }
    }
    return { results, total: results.length, succeeded: results.filter((r) => r.ok).length };
  }
}
