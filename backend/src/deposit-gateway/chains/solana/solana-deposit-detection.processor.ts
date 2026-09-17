import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { DepositService } from '../../../deposits/deposit.service';
import { DepositStatus } from '../../../deposits/deposit.entity';
import { DepositAddressService } from '../../addresses/deposit-address.service';
import { TokenRegistryService } from '../../tokens/token-registry.service';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { SOLANA_CHAIN_ID } from '../../config/networks.config';
import { SolanaDepositAdapter } from './solana-deposit-adapter';
import {
  computeSolanaConfirmations,
  extractSplTransfer,
} from './solana-token-transfer.parser';

export const SOLANA_DETECTION_QUEUE = 'solana-deposit-detection';

interface SolanaDetectJobData {
  chainId: number;
  signature: string;
  detectedAt: string;
}

@Processor(SOLANA_DETECTION_QUEUE)
@Injectable()
export class SolanaDepositDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(SolanaDepositDetectionProcessor.name);

  constructor(
    private readonly depositService: DepositService,
    private readonly addressService: DepositAddressService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    @InjectQueue(SOLANA_DETECTION_QUEUE)
    private readonly solanaQueue: Queue,
    @InjectQueue('deposit-confirmation')
    private readonly confirmationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'detect-solana-deposit') {
      await this.detect(job);
      return;
    }
    if (job.name === 'confirm-solana-deposit') {
      await this.confirm(job);
      return;
    }
  }

  private adapter(): SolanaDepositAdapter {
    return new SolanaDepositAdapter(this.networkRegistry.getNetwork('solana'));
  }
  private async detect(job: Job<SolanaDetectJobData>): Promise<void> {
    const data = job.data;
    const network = this.networkRegistry.getNetwork('solana');
    const adapter = this.adapter();

    const transfer = extractSplTransfer(
      await adapter.getTransaction(data.signature),
      data.signature,
    );
    if (!transfer) {
      // Not a safely attributable SPL USDT transfer → ignore, NEVER credit.
      this.logger.warn(`Ignoring ${data.signature}: not a parsed SPL transfer`);
      return;
    }
    if (!transfer.success) {
      this.logger.warn(`Rejecting ${data.signature}: transaction failed on-chain`);
      return;
    }
    if (!transfer.destinationTokenAccount) {
      this.logger.warn(`Ignoring ${data.signature}: no destination token account`);
      return;
    }

    // Recipient mapping: destination token account → deposit address → user.
    const depositAddress = await this.resolveDepositAddress(
      adapter,
      network.usdtContract,
      transfer.destinationTokenAccount,
    );
    if (!depositAddress) {
      this.logger.warn(
        `Ignoring ${data.signature}: destination token account is not a TradeX deposit address`,
      );
      return;
    }

    const depositAddressEntity =
      await this.addressService.findByAddressAndChainId(depositAddress, SOLANA_CHAIN_ID);
    if (!depositAddressEntity || !depositAddressEntity.userId) {
      this.logger.warn(`Ignoring ${data.signature}: recipient is not an assigned deposit address`);
      return;
    }
    const userId = depositAddressEntity.userId;

    const receivedRaw = BigInt(transfer.amountRaw);
    if (receivedRaw <= 0n) {
      this.logger.warn(`Ignoring ${data.signature}: zero amount`);
      return;
    }

    const token = this.tokenRegistry.getToken('USDT', SOLANA_CHAIN_ID);
    const usdtAmount = formatUnits(receivedRaw, token.decimals);
    const tdxAmount = formatUnits(receivedRaw * BigInt(token.tdxRate), token.decimals);

    const latestSlot = await adapter.getLatestSlot();
    const confirmations = computeSolanaConfirmations(latestSlot, transfer.slot);

    let deposit;
    try {
      deposit = await this.depositService.createDeposit({
        userId,
        walletId: null,
        orderId: depositAddressEntity.orderId ?? null,
        depositAddress,
        chainId: SOLANA_CHAIN_ID,
        transactionHash: data.signature,
        blockNumber: transfer.slot,
        blockTimestamp:
          transfer.blockTime != null ? new Date(transfer.blockTime * 1000) : new Date(),
        vaultAddress: transfer.destinationTokenAccount,
        senderAddress: transfer.sourceTokenAccount ?? transfer.authority ?? '',
        amount: transfer.amountRaw,
        usdtAmount,
        tdxAmount,
        confirmations,
        requiredConfirmations: network.confirmations,
      });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      if (e?.status === 409 || e?.message?.includes('already processed')) {
        this.logger.warn(`Duplicate SOLANA detection for ${data.signature}`);
        return;
      }
      throw error;
    }

    if (confirmations >= network.confirmations) {
      await this.depositService.updateConfirmations(deposit.id, confirmations);
      await this.enqueueCredit(deposit.id, userId);
    } else {
      await this.enqueueConfirm(deposit.id, data.signature);
    }
  }

  private async confirm(job: Job<{ depositId: string; signature: string }>): Promise<void> {
    const { depositId, signature } = job.data;
    const deposit = await this.depositService.getDepositById(depositId);
    if (
      !deposit ||
      deposit.status === DepositStatus.COMPLETED ||
      deposit.status === DepositStatus.FAILED
    ) {
      return;
    }

    const network = this.networkRegistry.getNetwork('solana');
    const adapter = this.adapter();

    // Never trust a previously stored confirmation count — revalidate on-chain.
    const statuses = await adapter.getSignatureStatuses([signature]);
    const status = statuses.find((s) => s?.signature === signature || s?.slot != null);
    if (!status) {
      // Transaction disappeared / not yet indexed — keep pending, retry.
      await this.enqueueConfirm(depositId, signature);
      return;
    }
    if (status.err) {
      this.logger.warn(`SOLANA deposit ${signature} reverted/failed on-chain`);
      await this.depositService.updateDepositStatus(
        depositId,
        DepositStatus.FAILED,
        'Solana transaction failed on-chain',
      );
      return;
    }

    const latestSlot = await adapter.getLatestSlot();
    const confirmations = computeSolanaConfirmations(
      latestSlot,
      Number(status.slot ?? deposit.blockNumber),
    );

    await this.depositService.updateConfirmations(depositId, confirmations);

    if (confirmations >= network.confirmations) {
      await this.enqueueCredit(deposit.id, deposit.userId);
    } else {
      await this.enqueueConfirm(depositId, signature);
    }
  }

  /** Resolve the deposit address whose USDT token account received funds. */
  private async resolveDepositAddress(
    adapter: SolanaDepositAdapter,
    mint: string,
    destinationTokenAccount: string,
  ): Promise<string | null> {
    const addresses = await this.addressService.findActiveByChain(SOLANA_CHAIN_ID);
    const matches: string[] = [];
    for (const addr of addresses) {
      const tokenAccounts = await adapter.getTokenAccountsByOwner(addr.address, mint);
      if (tokenAccounts.includes(destinationTokenAccount)) {
        matches.push(addr.address);
      }
    }
    // Ambiguity can never be safely credited — manual review instead.
    return matches.length === 1 ? matches[0] : null;
  }

  private async enqueueCredit(depositId: string, userId: string): Promise<void> {
    await this.confirmationQueue.add(
      'credit-deposit',
      { depositId, userId },
      {
        jobId: `solana-credit-${depositId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private async enqueueConfirm(depositId: string, signature: string): Promise<void> {
    await this.solanaQueue.add(
      'confirm-solana-deposit',
      { depositId, signature },
      {
        jobId: `solana-confirm-${depositId}`,
        delay: 30000,
        attempts: 20,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}

/** ethers-style raw → human units (bigint-safe, no floats). */
function formatUnits(raw: bigint, decimals: number): string {
  let s = raw.toString();
  if (decimals === 0) return s;
  s = s.padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return `${whole}.${frac || '0'}`;
}