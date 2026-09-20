import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { ethers } from 'ethers';

import { InjectQueue } from '@nestjs/bullmq';

import type { Queue } from 'bullmq';

// ============================================================
// TRADEX BSC DEPOSIT WATCHER
// ============================================================
//
// BSC MAINNET ONLY
// Chain ID: 56
//
// USDT:
// 0x55d398326f99059fF775485246999027B3197955
//
// DEPOSIT VAULT:
// 0x4fF37b7dEb8031F7dCF43cceC86CC20099a4394E
//
// IMPORTANT
// ------------------------------------------------------------
// This service watches USDT Transfer events sent to the
// TradeX Deposit Vault.
//
// It does NOT credit user balances directly.
// DepositService / confirmation worker handles that.
//
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

@Injectable()
export class BscWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  // ==========================================================
  // PROVIDERS
  // ==========================================================

  private readonly providers: ethers.JsonRpcProvider[];

  private activeProviderIndex = 0;

  // ==========================================================
  // CONTRACT
  // ==========================================================

  private readonly usdtInterface = new ethers.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ]);

  // ==========================================================
  // CONFIG
  // ==========================================================

  private readonly usdtAddress: string;

  private readonly vaultAddress: string;

  private readonly chainId: number;

  private readonly requiredConfirmations: number;

  private readonly scanInterval: number;

  private readonly maxBlocksPerScan: number;

  // ==========================================================
  // STATE
  // ==========================================================

  private lastProcessedBlock = 0;

  private isScanning = false;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // ==========================================================
  // DUPLICATE PROTECTION
  // ==========================================================

  private readonly queuedTransactions = new Set<string>();

  // ==========================================================
  // RPC SETTINGS
  // ==========================================================

  private readonly maxRpcAttempts = 3;

  private readonly rpcRetryDelays = [2000, 5000, 10000];

  // ==========================================================
  // STARTUP LOOKBACK
  // ==========================================================

  private readonly startupLookbackBlocks = 100;

  // ==========================================================
  // CONSTRUCTOR
  // ==========================================================

  constructor(
    private readonly configService: ConfigService,

    @InjectQueue('deposit-detection')
    private readonly depositQueue: Queue,
  ) {
    // ========================================================
    // RPC (primary → fallback → fallback_2)
    // ========================================================

    const primaryRpc = this.configService.get<string>('BSC_RPC_URL')?.trim();

    const fallbackRpc = this.configService
      .get<string>('BSC_RPC_URL_FALLBACK')
      ?.trim();

    const fallbackRpc2 = this.configService
      .get<string>('BSC_RPC_URL_FALLBACK_2')
      ?.trim();

    if (!primaryRpc) {
      throw new Error('BSC_RPC_URL is not configured');
    }

    if (!fallbackRpc) {
      throw new Error('BSC_RPC_URL_FALLBACK is not configured');
    }

    const providerUrls = [primaryRpc, fallbackRpc, fallbackRpc2]
      .filter((url): url is string => Boolean(url));

    this.providers = providerUrls.map((url) =>
      new ethers.JsonRpcProvider(url, 56, {
        staticNetwork: true,
      }),
    );

    // ========================================================
    // USDT
    // ========================================================

    const configuredUsdt = this.configService
      .get<string>('BSC_USDT_ADDRESS')
      ?.trim();

    if (!configuredUsdt) {
      throw new Error('BSC_USDT_ADDRESS is not configured');
    }

    this.usdtAddress = ethers.getAddress(configuredUsdt);

    // ========================================================
    // VAULT
    // ========================================================

    const configuredVault = this.configService
      .get<string>('TRADEX_VAULT_ADDRESS')
      ?.trim();

    if (!configuredVault) {
      throw new Error('TRADEX_VAULT_ADDRESS is not configured');
    }

    this.vaultAddress = ethers.getAddress(configuredVault);

    // ========================================================
    // CHAIN
    // ========================================================

    this.chainId = Number(
      this.configService.get<string>('BSC_CHAIN_ID') || '56',
    );

    if (this.chainId !== 56) {
      throw new Error(
        `TradeX requires BSC Mainnet. Current chainId=${this.chainId}`,
      );
    }

    // ========================================================
    // CONFIRMATIONS
    // ========================================================

    this.requiredConfirmations = Number(
      this.configService.get<string>('BSC_REQUIRED_CONFIRMATIONS') || '15',
    );

    // ========================================================
    // SCAN INTERVAL
    // ========================================================

    this.scanInterval = Number(
      this.configService.get<string>('BSC_SCAN_INTERVAL') || '60000',
    );

    // ========================================================
    // MAX BLOCKS
    // ========================================================

    const configuredMaxBlocks = Number(
      this.configService.get<string>('BSC_MAX_BLOCKS_PER_SCAN') || '10',
    );

    this.maxBlocksPerScan = Math.max(1, Math.min(configuredMaxBlocks, 10));

    // ========================================================
    // LOG
    // ========================================================

    console.log('📡 TradeX BSC Watcher configuration');

    console.log(`⛓️ Chain ID: ${this.chainId}`);

    console.log(`💵 USDT: ${this.usdtAddress}`);

    console.log(`🏦 Deposit Vault: ${this.vaultAddress}`);

    console.log(`🔐 Required confirmations: ${this.requiredConfirmations}`);

    console.log(`📦 Max blocks per log request: ${this.maxBlocksPerScan}`);

    console.log(`🔁 Scan interval: ${this.scanInterval}ms`);

    console.log('🛟 Fallback RPC: enabled');
  }

  // ==========================================================
  // MODULE INIT
  // ==========================================================

  // ==========================================================
  // MODULE INIT — NON-BLOCKING (cold-start safety)
  // ==========================================================
  //
  // Nest awaits every onModuleInit hook BEFORE NestFactory.create() returns
  // and before main.ts binds the HTTP port (app.listen()). Awaiting an
  // external BSC RPC here used to delay readiness by seconds and — when RPC
  // was unavailable at boot — REJECTED into a process crash/restart loop
  // that made every request (including auth) fail.
  //
  // Startup therefore happens in the BACKGROUND from onApplicationBootstrap:
  //   - the port binds immediately,
  //   - the same priming + lookback scan + startWatching sequence runs,
  //   - RPC failure is caught, logged, and retried (bounded per attempt,
  //     repeating until the RPC recovers) instead of crashing,
  //   - duplicate startup is prevented by a one-shot guard plus the
  //     existing intervalHandle / isScanning protections.
  // ==========================================================

  /** One-shot guard so background startup can never run twice. */
  private startupStarted = false;

  /** Pending delayed retry of background startup (cleared on destroy). */
  private startupRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Delay between background startup retries (overridable in tests). */
  private readonly startupRetryDelayMs = 30_000;

  onApplicationBootstrap(): void {
    if (this.startupStarted) {
      return;
    }
    this.startupStarted = true;
    void this.initializeWatcher();
  }

  private async initializeWatcher(): Promise<void> {
    try {
      await this.primeWatcher();
    } catch (error) {
      // RPC failure must never crash the Nest process: log, keep serving,
      // and retry priming in the background until the RPC recovers.
      console.error(
        `❌ BSC Watcher startup could not read the current block — retrying in ${this.startupRetryDelayMs}ms`,
        error,
      );
      this.scheduleStartupRetry();
      return;
    }

    // ========================================================
    // IMPORTANT
    // ========================================================
    //
    // Do NOT run a huge startup scan.
    //
    // First scan the controlled lookback window.
    //
    // (scanMissedBlocks catches its own errors; the try/catch below is a
    // final guarantee that a background rejection can never become an
    // unhandled promise rejection / process crash.)
    try {
      await this.scanMissedBlocks();
    } catch (error) {
      console.error('❌ BSC Watcher startup scan failed:', error);
    }

    this.startWatching();
  }

  /**
   * Reads the current block and seeds lastProcessedBlock with the SAME
   * startup lookback as before. Throws on RPC failure (caller retries).
   */
  private async primeWatcher(): Promise<void> {
    const currentBlock = await this.getCurrentBlock();

    this.lastProcessedBlock = Math.max(
      0,
      currentBlock - this.startupLookbackBlocks,
    );

    console.log('📡 BSC Watcher initialized');

    console.log(`⛓️ Active BSC chainId: ${this.chainId}`);

    console.log(`📍 Current block: ${currentBlock}`);

    console.log(`📍 Starting scan from: ${this.lastProcessedBlock}`);
  }

  private scheduleStartupRetry(): void {
    if (this.startupRetryTimer) {
      return;
    }
    this.startupRetryTimer = setTimeout(() => {
      this.startupRetryTimer = null;
      void this.initializeWatcher();
    }, this.startupRetryDelayMs);
    this.startupRetryTimer.unref?.();
  }

  // ==========================================================
  // MODULE DESTROY
  // ==========================================================

  onModuleDestroy(): void {
    if (this.startupRetryTimer) {
      clearTimeout(this.startupRetryTimer);
      this.startupRetryTimer = null;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);

      this.intervalHandle = null;
    }
  }

  // ==========================================================
  // START WATCHER
  // ==========================================================

  private startWatching(): void {
    if (this.intervalHandle) {
      return;
    }

    console.log('🚀 Starting BSC deposit watcher...');

    this.intervalHandle = setInterval(() => {
      void this.scanMissedBlocks();
    }, this.scanInterval);

    console.log('✅ BSC watcher started successfully');
  }

  // ==========================================================
  // CURRENT BLOCK
  // ==========================================================

  private async getCurrentBlock(): Promise<number> {
    return this.withProviderFailover(
      (provider) => provider.getBlockNumber(),
      'getBlockNumber',
    );
  }

  // ==========================================================
  // SCAN
  // ==========================================================

  private async scanMissedBlocks(): Promise<void> {
    if (this.isScanning) {
      return;
    }

    this.isScanning = true;

    try {
      const currentBlock = await this.getCurrentBlock();

      if (this.lastProcessedBlock >= currentBlock) {
        return;
      }

      console.log(
        `🔍 Scanning BSC blocks: ${
          this.lastProcessedBlock + 1
        } → ${currentBlock}`,
      );

      let fromBlock = this.lastProcessedBlock + 1;

      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(
          fromBlock + this.maxBlocksPerScan - 1,
          currentBlock,
        );

        console.log(`🔎 Checking blocks ${fromBlock} → ${toBlock}`);

        let logs: ethers.Log[];

        try {
          logs = await this.getTransferLogs(fromBlock, toBlock);
        } catch (error) {
          console.error(
            `❌ Unable to read blocks ${fromBlock} → ${toBlock}`,
            error,
          );

          // ==================================================
          // VERY IMPORTANT
          // ==================================================
          //
          // Do NOT advance lastProcessedBlock.
          //
          // Failed block will be retried on next scan.
          //
          // ==================================================

          return;
        }

        await this.processLogs(logs);

        // ====================================================
        // ONLY AFTER SUCCESS
        // ====================================================

        this.lastProcessedBlock = toBlock;

        fromBlock = toBlock + 1;

        // ====================================================
        // Small cooldown between log requests.
        //
        // This is important for public RPC endpoints.
        // ====================================================

        if (fromBlock <= currentBlock) {
          await this.sleep(300);
        }
      }

      console.log(`✅ BSC scan completed through block ${currentBlock}`);
    } catch (error) {
      console.error('❌ Error in BSC block scanner:', error);
    } finally {
      this.isScanning = false;
    }
  }

  // ==========================================================
  // GET TRANSFER LOGS
  // ==========================================================

  private async getTransferLogs(
    fromBlock: number,
    toBlock: number,
  ): Promise<ethers.Log[]> {
    let lastError: unknown = null;

    for (
      let providerAttempt = 0;
      providerAttempt < this.providers.length;
      providerAttempt++
    ) {
      const provider = this.getActiveProvider();

      for (let attempt = 0; attempt < this.maxRpcAttempts; attempt++) {
        try {
          const logs = await provider.getLogs({
            address: this.usdtAddress,

            fromBlock,

            toBlock,

            topics: [
              ethers.id('Transfer(address,address,uint256)'),

              null,

              ethers.zeroPadValue(this.vaultAddress, 32),
            ],
          });

          return logs;
        } catch (error) {
          lastError = error;

          const message = this.getErrorMessage(error);

          console.warn(
            `⚠️ BSC RPC error (provider ${
              this.activeProviderIndex + 1
            }/${this.providers.length}, attempt ${
              attempt + 1
            }/${this.maxRpcAttempts}): ${message}`,
          );

          // ==================================================
          // RATE LIMIT
          // ==================================================

          if (this.isRateLimitError(error)) {
            // ----------------------------------------------
            // Wait before doing anything else.
            // ----------------------------------------------

            const delay = this.rpcRetryDelays[attempt] ?? 10000;

            console.warn(`⏳ RPC rate limit. Waiting ${delay}ms...`);

            await this.sleep(delay);

            // ----------------------------------------------
            // After repeated rate limit,
            // switch provider.
            // ----------------------------------------------

            if (attempt === this.maxRpcAttempts - 1) {
              console.warn(`🔄 Switching BSC RPC provider.`);

              this.switchProvider();
            }

            continue;
          }

          // ==================================================
          // OTHER RPC ERROR
          // ==================================================

          await this.sleep(this.rpcRetryDelays[attempt] ?? 10000);
        }
      }
    }

    throw lastError || new Error('All BSC RPC providers failed');
  }

  // ==========================================================
  // PROCESS LOGS
  // ==========================================================

  private async processLogs(logs: ethers.Log[]): Promise<void> {
    if (!logs.length) {
      return;
    }

    console.log(`💵 Found ${logs.length} USDT transfer(s) to TradeX vault`);

    // ====================================================
    // FAILURE TRACKING
    // ====================================================
    //
    // If ANY transfer fails to process (transient RPC failure while
    // verifying the receipt, or Redis/queue failure), the caller MUST
    // NOT advance lastProcessedBlock past this block. Advancing would
    // permanently drop the deposit — it would never be re-scanned and
    // never reach the deposits table.
    //
    // We continue processing the remaining logs in the batch (so one
    // bad log does not block the others), then rethrow at the end so
    // scanMissedBlocks() leaves lastProcessedBlock unchanged. The same
    // block range is retried on the next scan cycle, and existing
    // duplicate protection (queuedTransactions set + jobId + deposits
    // unique transaction_hash) prevents double-queueing.
    // ====================================================

    let failed = false;

    for (const log of logs) {
      try {
        const parsed = this.usdtInterface.parseLog({
          topics: log.topics,
          data: log.data,
        });

        if (!parsed) {
          continue;
        }

        if (parsed.name !== 'Transfer') {
          continue;
        }

        const from = ethers.getAddress(parsed.args[0] as string);

        const to = ethers.getAddress(parsed.args[1] as string);

        const amount = parsed.args[2] as bigint;

        // ====================================================
        // FINAL SECURITY CHECK
        // ====================================================

        if (to !== this.vaultAddress) {
          continue;
        }

        if (amount <= 0n) {
          continue;
        }

        if (!log.transactionHash) {
          continue;
        }

        await this.handleTransfer(
          from,
          to,
          amount,
          log.transactionHash,
          log.blockNumber,
        );
      } catch (error) {
        failed = true;

        console.error(
          `❌ Failed to process USDT transfer log ${log.transactionHash}:`,
          error,
        );
      }
    }

    if (failed) {
      throw new Error(
        'One or more USDT transfers failed to process — block range will be retried on the next scan',
      );
    }
  }

  // ==========================================================
  // HANDLE TRANSFER
  // ==========================================================

  private async handleTransfer(
    from: string,
    to: string,
    amount: bigint,
    txHash: string,
    blockNumber: number,
  ): Promise<void> {
    const normalizedTx = txHash.toLowerCase();

    // ========================================================
    // MEMORY DUPLICATE PROTECTION
    // ========================================================

    if (this.queuedTransactions.has(normalizedTx)) {
      console.log(`⚠️ Deposit already queued: ${txHash}`);

      return;
    }

    this.queuedTransactions.add(normalizedTx);

    try {
      // ======================================================
      // VERIFY RECEIPT
      // ======================================================

      const receipt = await this.getTransactionReceipt(txHash);

      if (!receipt) {
        throw new Error(`Transaction receipt not found: ${txHash}`);
      }

      if (receipt.status !== 1) {
        console.warn(`⚠️ Transaction failed: ${txHash}`);

        return;
      }

      // ======================================================
      // QUEUE
      // ======================================================

      const jobData: DepositJobData = {
        chainId: this.chainId,

        transactionHash: txHash,

        from,

        to,

        amount: amount.toString(),

        blockNumber,

        detectedAt: new Date().toISOString(),
      };

      const queueJobId = `deposit-${normalizedTx}`;

      console.log(
        `📤 Queueing deposit detection job: ${queueJobId} (queue=deposit-detection)`,
      );

      await this.depositQueue.add('detect-deposit', jobData, {
        // Retry window: 12 attempts with exponential backoff (5s → 10s →
        // 20s → ... ≈ 2.8h cumulative) so a deposit is NOT permanently
        // lost if the sender wallet registers shortly AFTER the on-chain
        // transfer. Same job id — no duplicate jobs are created.
        jobId: queueJobId,

        attempts: 12,

        backoff: {
          type: 'exponential',
          delay: 5000,
        },

        removeOnComplete: true,

        removeOnFail: false,
      });

      console.log(`📥 Deposit queued: ${txHash}`);

      console.log(
        `🆔 Job ID: ${queueJobId} | Queue: deposit-detection | Attempts: 12`,
      );

      console.log(`💰 Amount: ${ethers.formatUnits(amount, 18)} USDT`);

      console.log(`👤 From: ${from}`);

      console.log(`🏦 Vault: ${to}`);
    } catch (error) {
      // ======================================================
      // Allow future retry if queue/verification failed.
      // ======================================================

      this.queuedTransactions.delete(normalizedTx);

      throw error;
    }
  }

  // ==========================================================
  // RECEIPT
  // ==========================================================

  private async getTransactionReceipt(
    txHash: string,
  ): Promise<ethers.TransactionReceipt | null> {
    return this.withProviderFailover(
      (provider) => provider.getTransactionReceipt(txHash),
      'getTransactionReceipt',
    );
  }

  // ==========================================================
  // PROVIDER FAILOVER
  // ==========================================================
  //
  // Runs an RPC operation across ALL configured providers
  // (primary → fallback → fallback_2). On RPC-level failure it
  // rotates to the next provider; non-RPC errors (reverted tx,
  // not found) propagate immediately.
  // ==========================================================

  private async withProviderFailover<T>(
    operation: (provider: ethers.JsonRpcProvider) => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.getActiveProvider();

      try {
        const result = await operation(provider);
        return result;
      } catch (error) {
        lastError = error;

        if (this.isRateLimitError(error) || this.isRpcError(error)) {
          console.warn(
            `⚠️ ${label} failed on RPC ${
              this.activeProviderIndex + 1
            }: ${this.getErrorMessage(error)}. Switching provider.`,
          );

          this.switchProvider();
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  private isRpcError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();

    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('name_not_resolved') ||
      message.includes('dns') ||
      message.includes('network error') ||
      message.includes('429') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('socket hang up') ||
      message.includes('fetch failed') ||
      message.includes('request timed out') ||
      message.includes('unexpected eof')
    );
  }

  // ==========================================================
  // PROVIDER
  // ==========================================================

  private getActiveProvider(): ethers.JsonRpcProvider {
    return this.providers[this.activeProviderIndex];
  }

  // ==========================================================
  // SWITCH PROVIDER
  // ==========================================================

  private switchProvider(): void {
    if (this.providers.length <= 1) {
      return;
    }

    this.activeProviderIndex =
      (this.activeProviderIndex + 1) % this.providers.length;

    console.log(
      `🔄 Active RPC provider switched to ${this.activeProviderIndex + 1}`,
    );
  }

  // ==========================================================
  // RATE LIMIT DETECTION
  // ==========================================================

  private isRateLimitError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();

    return (
      message.includes('-32005') ||
      message.includes('rate limit') ||
      message.includes('limit exceeded') ||
      message.includes('eth_getlogs') ||
      message.includes('method eth_getlogs') ||
      message.includes('too many requests') ||
      message.includes('too many results') ||
      message.includes('request limit')
    );
  }

  // ==========================================================
  // ERROR MESSAGE
  // ==========================================================

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown RPC error';
    }
  }

  // ==========================================================
  // SLEEP
  // ==========================================================

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
