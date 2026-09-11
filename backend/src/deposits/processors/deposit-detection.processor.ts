// ============================================================
// TRADEX DEPOSIT DETECTION PROCESSOR
// ============================================================
//
// RESPONSIBILITY
// ------------------------------------------------------------
// 1. Validate BSC Mainnet
// 2. Validate TradeX Deposit Vault
// 3. Validate successful transaction
// 4. Validate USDT Transfer event
// 5. Validate sender wallet
// 6. Create deposit record
// 7. Queue confirmation job
//
// IMPORTANT
// ------------------------------------------------------------
// The transaction itself is:
//
// User Wallet
//      ↓
// TradeX Deposit Vault.depositUSDT()
//      ↓
// USDT Transfer event
//      ↓
// Deposit Vault receives USDT
//
// Therefore:
//
// receipt.to === Deposit Vault
//
// NOT:
//
// receipt.to === USDT contract
//
// USDT contract validation is done through the Transfer log.
// ============================================================

import { Processor, Process } from '@nestjs/bull';

import { InjectQueue } from '@nestjs/bull';

import type { Job } from 'bull';

import type { Queue } from 'bull';

import { Injectable } from '@nestjs/common';

import { ethers } from 'ethers';

import { ConfigService } from '@nestjs/config';

import { DepositService } from '../deposit.service';

import { WalletsService } from '../../wallets/wallets.service';

// ============================================================
// JOB DATA
// ============================================================

interface DepositJobData {
  chainId: number;

  transactionHash: string;

  from: string;

  to: string;

  amount: string;

  blockNumber: number;

  detectedAt: string;
}

// ============================================================
// PROCESSOR
// ============================================================

@Processor('deposit-detection')
@Injectable()
export class DepositDetectionProcessor {
  // ==========================================================
  // BLOCKCHAIN
  // ==========================================================

  private readonly provider: ethers.JsonRpcProvider;

  private readonly usdtContract: ethers.Contract;

  // ==========================================================
  // CONFIG
  // ==========================================================

  private readonly requiredConfirmations: number;

  private readonly expectedVaultAddress: string;

  private readonly expectedUsdtAddress: string;

  private readonly expectedChainId: number;

  private readonly usdtDecimals: number;

  private readonly minUsdtDeposit: bigint;

  // ==========================================================
  // CONSTRUCTOR
  // ==========================================================

  constructor(
    private readonly depositService: DepositService,

    private readonly configService: ConfigService,

    private readonly walletsService: WalletsService,

    @InjectQueue('deposit-confirmation')
    private readonly confirmationQueue: Queue,
  ) {
    // ========================================================
    // RPC
    // ========================================================

    const rpcUrl = this.configService.get<string>('BSC_RPC_URL')?.trim() || '';

    if (!rpcUrl) {
      throw new Error('BSC_RPC_URL is not configured');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl, 56, {
      staticNetwork: true,
    });

    // ========================================================
    // USDT
    // ========================================================

    const usdtAddress =
      this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || '';

    if (!usdtAddress) {
      throw new Error('BSC_USDT_ADDRESS is not configured');
    }

    this.expectedUsdtAddress = ethers.getAddress(usdtAddress);

    // ========================================================
    // VAULT
    // ========================================================

    const vaultAddress =
      this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() || '';

    if (!vaultAddress) {
      throw new Error('TRADEX_VAULT_ADDRESS is not configured');
    }

    this.expectedVaultAddress = ethers.getAddress(vaultAddress);

    // ========================================================
    // CHAIN
    // ========================================================

    this.expectedChainId = Number(
      this.configService.get<string>('BSC_CHAIN_ID') || '56',
    );

    if (this.expectedChainId !== 56) {
      throw new Error(
        `TradeX requires BSC Mainnet. Current chainId=${this.expectedChainId}`,
      );
    }

    // ========================================================
    // CONFIRMATIONS
    // ========================================================

    this.requiredConfirmations = Number(
      this.configService.get<string>('BSC_REQUIRED_CONFIRMATIONS') || '15',
    );

    // ========================================================
    // USDT DECIMALS
    // ========================================================
    //
    // BSC USDT used by TradeX has 18 decimals.
    //
    // Can be overridden through environment if needed.
    // ========================================================

    this.usdtDecimals = Number(
      this.configService.get<string>('BSC_USDT_DECIMALS') || '18',
    );

    this.minUsdtDeposit = ethers.parseUnits(
      this.configService.get<string>('MIN_USDT_DEPOSIT') || '1',
      this.usdtDecimals,
    );

    // ========================================================
    // USDT ABI
    // ========================================================

    const abi = [
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ] as const;

    this.usdtContract = new ethers.Contract(
      this.expectedUsdtAddress,
      abi,
      this.provider,
    );

    // ========================================================
    // STARTUP LOG
    // ========================================================

    console.log('🧩 TradeX DepositDetectionProcessor initialized');

    console.log(`⛓️ Chain ID: ${this.expectedChainId}`);

    console.log(`💵 USDT: ${this.expectedUsdtAddress}`);

    console.log(`🏦 Deposit Vault: ${this.expectedVaultAddress}`);

    console.log(`🔐 Required confirmations: ${this.requiredConfirmations}`);

    console.log(`🔢 USDT decimals: ${this.usdtDecimals}`);
  }

  // ==========================================================
  // DETECT DEPOSIT
  // ==========================================================

  @Process('detect-deposit')
  async handleDepositDetection(job: Job<DepositJobData>): Promise<void> {
    const { chainId, transactionHash, from, to, amount } = job.data;

    console.log(`🔍 Detecting deposit: ${transactionHash}`);

    try {
      // ======================================================
      // NORMALIZE INPUTS
      // ======================================================

      const normalizedFrom = ethers.getAddress(from);

      const normalizedTo = ethers.getAddress(to);

      const transferAmount = BigInt(amount);

      // ======================================================
      // CHECK 1 — CHAIN
      // ======================================================

      if (chainId !== this.expectedChainId) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: wrong chain (payload=${chainId}, expected=${this.expectedChainId})`,
        );

        return;
      }

      // ======================================================
      // CHECK 2 — VAULT
      // ======================================================

      if (normalizedTo !== this.expectedVaultAddress) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: vault mismatch (payload=${normalizedTo}, expected=${this.expectedVaultAddress})`,
        );

        return;
      }

      // ======================================================
      // CHECK 3 — AMOUNT
      // ======================================================

      if (transferAmount <= 0n) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: non-positive amount ${amount}`,
        );

        return;
      }

      if (transferAmount < this.minUsdtDeposit) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: below minimum (${ethers.formatUnits(transferAmount, this.usdtDecimals)} < ${ethers.formatUnits(this.minUsdtDeposit, this.usdtDecimals)} USDT)`,
        );

        return;
      }

      // ======================================================
      // CHECK 4 — DUPLICATE DATABASE RECORD
      // ======================================================

      const existing =
        await this.depositService.getDepositByTransactionHash(transactionHash);

      if (existing) {
        console.log(
          `⚠️ Deposit already exists: ${transactionHash} (${existing.status})`,
        );

        return;
      }

      // ======================================================
      // GET RECEIPT
      // ======================================================

      const receipt =
        await this.provider.getTransactionReceipt(transactionHash);

      if (!receipt) {
        throw new Error(`Transaction receipt not found: ${transactionHash}`);
      }

      // ======================================================
      // CHECK 5 — TRANSACTION SUCCESS
      // ======================================================

      if (receipt.status !== 1) {
        console.log(`❌ Transaction failed: ${transactionHash}`);

        return;
      }

      // ======================================================
      // CHECK 6 — PROVIDER NETWORK
      // ======================================================

      const network = await this.provider.getNetwork();

      const providerChainId = Number(network.chainId);

      if (providerChainId !== chainId) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: provider network mismatch (provider=${providerChainId}, payload=${chainId})`,
        );

        return;
      }

      // ======================================================
      // CHECK 7 — TRANSACTION DESTINATION
      // ======================================================
      //
      // IMPORTANT:
      //
      // depositUSDT() is called on the VAULT.
      //
      // Therefore receipt.to MUST be the Deposit Vault.
      //
      // It must NOT be the USDT contract.
      // ======================================================

      // ======================================================
      // CHECK 8 — USDT TRANSFER EVENT
      // ======================================================
      //
      // We verify the actual USDT Transfer event:
      //
      // USDT Contract
      //      ↓
      // Transfer(from, vault, amount)
      //
      // This proves that USDT actually moved to the vault.
      // ======================================================

      let hasMatchingTransferLog = false;

      for (const log of receipt.logs) {
        // ----------------------------------------------------
        // Only inspect USDT contract logs
        // ----------------------------------------------------

        let logAddress: string;

        try {
          logAddress = ethers.getAddress(log.address);
        } catch {
          continue;
        }

        if (logAddress !== this.expectedUsdtAddress) {
          continue;
        }

        // ----------------------------------------------------
        // Parse Transfer event
        // ----------------------------------------------------

        try {
          const parsed = this.usdtContract.interface.parseLog(log);

          if (!parsed || parsed.name !== 'Transfer') {
            continue;
          }

          const logFrom = ethers.getAddress(parsed.args.from as string);

          const logTo = ethers.getAddress(parsed.args.to as string);

          const logAmount = parsed.args.value as bigint;

          // --------------------------------------------------
          // Exact security match
          // --------------------------------------------------

          if (
            logFrom === normalizedFrom &&
            logTo === this.expectedVaultAddress &&
            logAmount === transferAmount
          ) {
            hasMatchingTransferLog = true;

            console.log(`✅ Matching USDT Transfer found: ${transactionHash}`);

            console.log(`👤 From: ${logFrom}`);

            console.log(`🏦 To: ${logTo}`);

            console.log(
              `💵 Amount: ${ethers.formatUnits(
                logAmount,
                this.usdtDecimals,
              )} USDT`,
            );

            break;
          }
        } catch {
          continue;
        }
      }

      // ======================================================
      // TRANSFER EVENT MUST EXIST
      // ======================================================

      if (!hasMatchingTransferLog) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: no matching USDT Transfer log to TradeX vault`,
        );

        return;
      }

      // ======================================================
      // CURRENT BLOCK
      // ======================================================

      const currentBlock = await this.provider.getBlockNumber();

      // ======================================================
      // CONFIRMATIONS
      // ======================================================

      const confirmations = currentBlock - receipt.blockNumber + 1;

      console.log(
        `🔐 Deposit confirmations: ${confirmations}/${this.requiredConfirmations}`,
      );

      // ======================================================
      // BLOCK TIMESTAMP
      // ======================================================

      const block = await this.provider.getBlock(receipt.blockNumber);

      if (!block) {
        throw new Error(`Block not found: ${receipt.blockNumber}`);
      }

      // ======================================================
      // CHECK 9 — REGISTERED WALLET
      // ======================================================

      const wallet = await this.walletsService.findByAddressAndChainId(
        normalizedFrom,
        chainId,
      );

      if (!wallet) {
        console.log(
          `⚠️ Uncredited deposit ${transactionHash}: unknown wallet ${normalizedFrom} on chain ${chainId}`,
        );

        return;
      }

      console.log(`✅ Registered wallet found: ${wallet.id}`);

      console.log(`👤 User ID: ${wallet.userId}`);

      // ======================================================
      // AMOUNT CONVERSION
      // ======================================================

      const usdtAmount = ethers.formatUnits(transferAmount, this.usdtDecimals);

      const usdtAmountNumber = Number(usdtAmount);

      if (!Number.isFinite(usdtAmountNumber) || usdtAmountNumber <= 0) {
        throw new Error(`Invalid USDT amount: ${usdtAmount}`);
      }

      // ======================================================
      // TDX CALCULATION
      // ======================================================
      //
      // Business rate:
      //
      // 1 USDT = 100 TDX
      //
      // Backend verification controls final credit.
      // ======================================================

      const TDX_RATE = 100n;

      const tdxAmount = ethers.formatUnits(
        transferAmount * TDX_RATE,
        this.usdtDecimals,
      );

      // ======================================================
      // DEPOSIT DATA
      // ======================================================

      const depositData = {
        userId: wallet.userId,

        walletId: wallet.id,

        chainId,

        transactionHash,

        blockNumber: receipt.blockNumber,

        blockTimestamp: new Date(block.timestamp * 1000),

        vaultAddress: this.expectedVaultAddress,

        senderAddress: normalizedFrom,

        amount: transferAmount.toString(),

        usdtAmount,

        tdxAmount,

        confirmations,

        requiredConfirmations: this.requiredConfirmations,
      };

      // ======================================================
      // CREATE DEPOSIT
      // ======================================================

      const deposit = await this.depositService.createDeposit(depositData);

      console.log(`✅ Deposit created: ${deposit.id}`);

      console.log(`💵 USDT: ${usdtAmount}`);

      console.log(`🪙 TDX: ${tdxAmount}`);

      console.log(
        `🔐 Confirmations: ${confirmations}/${this.requiredConfirmations}`,
      );

      // ======================================================
      // QUEUE CONFIRMATION
      // ======================================================

      await this.confirmationQueue.add(
        'confirm-deposit',
        {
          depositId: deposit.id,

          transactionHash,

          chainId,
        },
        {
          jobId: `confirm-${deposit.id}`,

          attempts: 20,

          backoff: {
            type: 'exponential',
            delay: 30000,
          },

          removeOnComplete: true,

          removeOnFail: false,
        },
      );

      console.log(`📥 Deposit confirmation queued: ${transactionHash}`);
    } catch (error) {
      console.error(`❌ Error processing deposit detection:`, error);

      throw error;
    }
  }
}
