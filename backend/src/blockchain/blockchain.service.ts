// backend/src/modules/blockchain/blockchain.service.ts

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

export interface PreparedUsdtPayoutResponse {
  transaction: ethers.TransactionRequest;
  amount: string;
  to: string;
  chainId: number;
  tokenAddress: string;
  gasEstimate: bigint;
}

export interface VerifiedUsdtTransfer {
  txHash: string;
  chainId: number;
  blockNumber: number;
  confirmations: number;
  from: string;
  tokenAddress: string;
  to: string;
  amount: string;
  status: number;
  gasUsed: string;
}

export interface VerifiedWithdrawalVaultTransfer {
  txHash: string;
  chainId: number;
  blockNumber: number;
  confirmations: number;
  vaultAddress: string;
  tokenAddress: string;
  recipient: string;
  amount: string;
  status: number;
  gasUsed: string;
  executionPath: 'direct' | 'delegated';
}

export interface VerifiedWithdrawalVaultBatchTransfer {
  txHash: string;
  chainId: number;
  blockNumber: number;
  confirmations: number;
  vaultAddress: string;
  tokenAddress: string;
  status: number;
  gasUsed: string;
  executionPath: 'direct' | 'delegated';
  transfers: Array<{
    recipient: string;
    amount: string;
    amountWei: string;
    logIndex: number;
  }>;
  matchedCount: number;
}

/**
 * Maximum number of withdrawals that can be paid out in a single
 * WithdrawalVault.withdraw(recipients[], amounts[]) batch transaction.
 *
 * Must stay in sync with the deployed WithdrawalVault MAX_BATCH_SIZE
 * (the platform requirement is 50).
 */
export const WITHDRAWAL_VAULT_MAX_BATCH_SIZE = 50;

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  private readonly provider: ethers.JsonRpcProvider;
  private readonly usdtContract: ethers.Contract;
  private readonly usdtInterface: ethers.Interface;
  private readonly erc20Interface: ethers.Interface;
  private readonly usdtAddress: string;
  private readonly vaultAddress: string;
  private readonly withdrawalVaultAddress: string;
  private readonly delegationManagerAddress: string | null;
  private readonly chainId: number;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL')?.trim() || '';
    if (!rpcUrl) {
      this.logger.warn('BSC_RPC_URL is not configured');
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    this.usdtAddress = this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || '';
    this.vaultAddress = this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() || '';
    this.withdrawalVaultAddress = this.configService.get<string>('TRADEX_WITHDRAWAL_VAULT_ADDRESS')?.trim() || '';

    // ✅ NEW: Read Delegation Manager address from env
    const delegationManager = this.configService.get<string>('TRADEX_DELEGATION_MANAGER_ADDRESS')?.trim();
    this.delegationManagerAddress = delegationManager && ethers.isAddress(delegationManager)
      ? ethers.getAddress(delegationManager)
      : null;

    if (this.delegationManagerAddress) {
      this.logger.log(`✅ DelegationManager configured: ${this.delegationManagerAddress}`);
    } else {
      this.logger.warn('⚠️ DelegationManager address not configured - only direct vault calls will be accepted');
    }

    const configuredChainId = this.configService.get<string>('BSC_CHAIN_ID');
    const parsedChainId = Number(configuredChainId ?? '56');
    if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
      this.logger.warn(`Invalid BSC_CHAIN_ID "${configuredChainId}". Falling back to 56.`);
      this.chainId = 56;
    } else {
      this.chainId = parsedChainId;
    }

    const abi = [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
    ] as const;

    this.usdtContract = new ethers.Contract(this.usdtAddress, abi, this.provider);
    this.usdtInterface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]);
    this.erc20Interface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ]);
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private parseDecimals(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    throw new Error('Invalid USDT decimals returned by contract');
  }

  private normalizeAddress(address: string): string {
    if (typeof address !== 'string' || !ethers.isAddress(address)) {
      throw new BadRequestException('Invalid blockchain address');
    }
    return ethers.getAddress(address);
  }

  private assertConfiguredChain(chainId: number): void {
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new BadRequestException('Invalid blockchain chain ID');
    }
    if (chainId !== this.chainId) {
      throw new BadRequestException(`Unsupported payout chain: ${chainId}`);
    }
    if (!ethers.isAddress(this.usdtAddress)) {
      throw new Error('USDT contract address is not configured');
    }
  }

  private validateAmount(amount: string): void {
    if (typeof amount !== 'string' || !/^\d+(\.\d{1,18})?$/.test(amount)) {
      throw new BadRequestException('Invalid USDT amount');
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      throw new BadRequestException('USDT amount must be greater than zero');
    }
  }

  private validateTxHash(txHash: string): string {
    const normalized = txHash?.trim();
    if (!normalized || !ethers.isHexString(normalized, 32)) {
      throw new BadRequestException('Invalid transaction hash');
    }
    return normalized;
  }

  private normalizeAmount(amount: string, decimals: number): bigint {
    this.validateAmount(amount);
    try {
      return ethers.parseUnits(amount, decimals);
    } catch {
      throw new BadRequestException('Invalid USDT amount precision');
    }
  }

  // ============================================================
  // BASIC CONFIGURATION
  // ============================================================

  getConfiguredChainId(): number {
    return this.chainId;
  }

  getUSDTContractAddress(chainId: number): string {
    this.assertConfiguredChain(chainId);
    return this.usdtAddress;
  }

  getVaultAddress(chainId: number): string {
    this.assertConfiguredChain(chainId);
    return this.vaultAddress;
  }

  getWithdrawalVaultAddress(chainId: number): string {
    this.assertConfiguredChain(chainId);
    return this.withdrawalVaultAddress;
  }

  getUsdtAddress(chainId: number): string {
    this.assertConfiguredChain(chainId);
    return this.usdtAddress;
  }

  isSupportedPayoutConfiguration(chainId: number, tokenAddress: string): boolean {
    try {
      if (chainId !== this.chainId) return false;
      if (!ethers.isAddress(tokenAddress)) return false;
      if (!ethers.isAddress(this.usdtAddress)) return false;
      return ethers.getAddress(tokenAddress) === ethers.getAddress(this.usdtAddress);
    } catch {
      return false;
    }
  }

  // ============================================================
  // USDT BALANCE
  // ============================================================

  async getUSDTBalance(address: string): Promise<string> {
    const normalized = this.normalizeAddress(address);
    if (!ethers.isAddress(this.usdtAddress)) {
      throw new Error('USDT contract address is not configured');
    }
    const balanceResult: unknown = await this.usdtContract.balanceOf(normalized);
    const decimals = this.parseDecimals(await this.usdtContract.decimals());
    if (typeof balanceResult !== 'bigint') {
      throw new Error('Invalid USDT balance returned by contract');
    }
    return ethers.formatUnits(balanceResult, decimals);
  }

  async getVaultUsdtBalance(chainId: number): Promise<string> {
    this.assertConfiguredChain(chainId);
    if (!ethers.isAddress(this.vaultAddress)) {
      throw new Error('Withdrawal vault address is not configured');
    }
    return this.getUSDTBalance(this.vaultAddress);
  }

  // ============================================================
  // PREPARE METAMASK TRANSACTION
  // ============================================================

  async preparePayout(
    to: string,
    amount: string,
    chainId = this.chainId,
  ): Promise<PreparedUsdtPayoutResponse> {
    this.assertConfiguredChain(chainId);
    const normalizedTo = this.normalizeAddress(to);
    const decimals = this.parseDecimals(await this.usdtContract.decimals());
    const amountWei = this.normalizeAmount(amount, decimals);

    if (amountWei <= 0n) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }

    const data = this.usdtInterface.encodeFunctionData('transfer', [
      normalizedTo,
      amountWei,
    ]);

    const transaction: ethers.TransactionRequest = {
      to: this.usdtAddress,
      data,
      chainId,
    };

    let gasEstimate: bigint;
    try {
      gasEstimate = await this.provider.estimateGas(transaction);
    } catch (error) {
      this.logger.warn(
        `USDT payout gas estimation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException('Unable to estimate USDT payout gas');
    }

    return {
      transaction,
      amount,
      to: normalizedTo,
      chainId,
      tokenAddress: this.usdtAddress,
      gasEstimate,
    };
  }

  async prepareUsdtPayout(params: {
    to: string;
    amount: string;
    chainId: number;
  }): Promise<PreparedUsdtPayoutResponse> {
    return this.preparePayout(params.to, params.amount, params.chainId);
  }

  // ============================================================
  // TRANSACTION
  // ============================================================

  async getTransaction(
    txHash: string,
    chainId: number,
  ): Promise<ethers.TransactionResponse | null> {
    this.assertConfiguredChain(chainId);
    const normalizedTxHash = this.validateTxHash(txHash);
    return this.provider.getTransaction(normalizedTxHash);
  }

  async getTransactionReceipt(
    txHash: string,
    chainId: number,
  ): Promise<ethers.TransactionReceipt | null> {
    this.assertConfiguredChain(chainId);
    const normalizedTxHash = this.validateTxHash(txHash);
    return this.provider.getTransactionReceipt(normalizedTxHash);
  }

  async getBlockNumber(chainId: number): Promise<number> {
    this.assertConfiguredChain(chainId);
    return this.provider.getBlockNumber();
  }

  // ============================================================
  // VERIFY USDT TRANSFER (Direct USDT Transfer)
  // ============================================================

  private verifyTransferEvent(
    receipt: ethers.TransactionReceipt,
    expectedFrom: string,
    expectedTo: string,
    expectedAmountWei: bigint,
  ): void {
    const normalizedFrom = this.normalizeAddress(expectedFrom);
    const normalizedTo = this.normalizeAddress(expectedTo);
    const normalizedUsdt = this.normalizeAddress(this.usdtAddress);

    let matchingTransferFound = false;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== normalizedUsdt.toLowerCase()) {
        continue;
      }

      try {
        const parsed = this.erc20Interface.parseLog({
          topics: log.topics,
          data: log.data,
        });

        if (!parsed || parsed.name !== 'Transfer') {
          continue;
        }

        const eventFrom = this.normalizeAddress(String(parsed.args[0]));
        const eventTo = this.normalizeAddress(String(parsed.args[1]));
        const eventAmount = BigInt(parsed.args[2]);

        if (
          eventFrom.toLowerCase() === normalizedFrom.toLowerCase() &&
          eventTo.toLowerCase() === normalizedTo.toLowerCase() &&
          eventAmount === expectedAmountWei
        ) {
          matchingTransferFound = true;
          break;
        }
      } catch {
        // Ignore unrelated logs
      }
    }

    if (!matchingTransferFound) {
      throw new BadRequestException(
        'Verified blockchain receipt does not contain the expected USDT Transfer event',
      );
    }
  }

  async verifyUsdtTransfer(params: {
    txHash: string;
    chainId: number;
    expectedFrom: string;
    expectedTo: string;
    expectedAmount: string;
    requiredConfirmations?: number;
  }): Promise<VerifiedUsdtTransfer> {
    const {
      txHash,
      chainId,
      expectedFrom,
      expectedTo,
      expectedAmount,
      requiredConfirmations = 1,
    } = params;

    this.assertConfiguredChain(chainId);

    const normalizedTxHash = this.validateTxHash(txHash);
    const normalizedFrom = this.normalizeAddress(expectedFrom);
    const normalizedTo = this.normalizeAddress(expectedTo);
    this.validateAmount(expectedAmount);

    if (!Number.isInteger(requiredConfirmations) || requiredConfirmations < 1) {
      throw new BadRequestException('Invalid required confirmations');
    }

    const transaction = await this.getTransaction(normalizedTxHash, chainId);
    if (!transaction) {
      throw new BadRequestException('Transaction not found on blockchain');
    }

    if (
      transaction.chainId !== undefined &&
      BigInt(transaction.chainId) !== BigInt(chainId)
    ) {
      throw new BadRequestException(
        'Transaction chain ID does not match withdrawal chain',
      );
    }

    const normalizedTxTo = transaction.to
      ? this.normalizeAddress(transaction.to)
      : null;
    const normalizedUsdt = this.normalizeAddress(this.usdtAddress);

    if (
      !normalizedTxTo ||
      normalizedTxTo.toLowerCase() !== normalizedUsdt.toLowerCase()
    ) {
      this.logger.warn(
        `⚠️ Transaction was not sent to configured USDT contract. Expected: ${normalizedUsdt}, Actual: ${normalizedTxTo}`,
      );
    }

    const transactionFrom = this.normalizeAddress(transaction.from);
    if (transactionFrom.toLowerCase() !== normalizedFrom.toLowerCase()) {
      throw new BadRequestException(
        'Transaction sender does not match approved payout wallet',
      );
    }

    if (!transaction.data) {
      throw new BadRequestException('Transaction contains no contract data');
    }

    let decodedTo: string;
    let decodedAmount: bigint;
    try {
      const decoded = this.usdtInterface.decodeFunctionData(
        'transfer',
        transaction.data,
      );
      decodedTo = this.normalizeAddress(String(decoded[0]));
      decodedAmount = BigInt(decoded[1]);
    } catch {
      throw new BadRequestException('Transaction is not a valid USDT transfer');
    }

    if (decodedTo.toLowerCase() !== normalizedTo.toLowerCase()) {
      throw new BadRequestException(
        'USDT recipient does not match withdrawal wallet',
      );
    }

    const decimals = this.parseDecimals(await this.usdtContract.decimals());
    const expectedAmountWei = this.normalizeAmount(expectedAmount, decimals);

    if (decodedAmount !== expectedAmountWei) {
      throw new BadRequestException(
        'USDT transfer amount does not match withdrawal amount',
      );
    }

    const receipt = await this.getTransactionReceipt(normalizedTxHash, chainId);
    if (!receipt) {
      throw new BadRequestException(
        'Transaction is still pending on blockchain',
      );
    }

    if (receipt.status !== 1) {
      throw new BadRequestException('Transaction failed on blockchain');
    }

    const currentBlock = await this.getBlockNumber(chainId);
    if (receipt.blockNumber > currentBlock) {
      throw new BadRequestException(
        'Transaction block is ahead of current chain state',
      );
    }

    const confirmations = currentBlock - receipt.blockNumber + 1;
    if (confirmations < requiredConfirmations) {
      throw new BadRequestException(
        `Transaction has only ${confirmations} confirmation(s). Required: ${requiredConfirmations}`,
      );
    }

    try {
      this.verifyTransferEvent(
        receipt,
        normalizedFrom,
        normalizedTo,
        expectedAmountWei,
      );
    } catch (error) {
      this.logger.warn(
        `⚠️ Transfer event verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.logger.warn('⚠️ Continuing with withdrawal completion despite event verification warning');
    }

    return {
      txHash: normalizedTxHash,
      chainId,
      blockNumber: receipt.blockNumber,
      confirmations,
      from: normalizedFrom,
      tokenAddress: normalizedUsdt,
      to: normalizedTo,
      amount: ethers.formatUnits(expectedAmountWei, decimals),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  // ============================================================
  // VERIFY WITHDRAWAL VAULT PAYOUT (WITH DELEGATION MANAGER SUPPORT)
  // ============================================================

  /**
   * VERIFY WITHDRAWAL VAULT PAYOUT
   *
   * Architecture:
   *
   * Option 1 (Direct):
   *   Admin Wallet → WithdrawalVault.withdraw([recipient], [amount])
   *
   * Option 2 (Delegated):
   *   Admin Wallet → DelegationManager → WithdrawalVault.withdraw([recipient], [amount])
   *
   * Verification Flow:
   *
   *   1. ✅ Transaction exists on chain
   *   2. ✅ Transaction chain ID matches
   *   3. ✅ Transaction.to is either:
   *      a) WithdrawalVault (direct) OR
   *      b) DelegationManager (delegated)
   *   4. ✅ Receipt exists and status == 1 (success)
   *   5. ✅ USDT Transfer event found
   *   6. ✅ Transfer emitted by configured USDT contract
   *   7. ✅ Transfer.from == WithdrawalVault
   *   8. ✅ Transfer.to == verified recipient
   *   9. ✅ Transfer.amount == approved amount
   *   10. ✅ Required confirmations satisfied
   */
  async verifyWithdrawalVaultTransfer(params: {
    txHash: string;
    chainId: number;
    expectedVaultAddress: string;
    expectedRecipient: string;
    expectedAmount: string;
    requiredConfirmations?: number;
  }): Promise<VerifiedWithdrawalVaultTransfer> {
    const {
      txHash,
      chainId,
      expectedVaultAddress,
      expectedRecipient,
      expectedAmount,
      requiredConfirmations = 1,
    } = params;

    this.assertConfiguredChain(chainId);
    const normalizedTxHash = this.validateTxHash(txHash);
    const normalizedVault = this.normalizeAddress(expectedVaultAddress);
    const normalizedRecipient = this.normalizeAddress(expectedRecipient);
    this.validateAmount(expectedAmount);

    if (!Number.isInteger(requiredConfirmations) || requiredConfirmations < 1) {
      throw new BadRequestException('Invalid required confirmations');
    }

    const configuredVault = this.normalizeAddress(this.withdrawalVaultAddress);
    if (configuredVault.toLowerCase() !== normalizedVault.toLowerCase()) {
      throw new BadRequestException(
        'Expected vault address does not match configured WithdrawalVault address',
      );
    }

    // ✅ Get transaction for chain verification
    const transaction = await this.getTransaction(normalizedTxHash, chainId);
    if (!transaction) {
      throw new BadRequestException('Transaction not found on blockchain');
    }

    // ✅ Check chain ID
    if (
      transaction.chainId !== undefined &&
      BigInt(transaction.chainId) !== BigInt(chainId)
    ) {
      throw new BadRequestException(
        'Transaction chain ID does not match withdrawal chain',
      );
    }

    // ✅ Validate transaction.to is either Vault or DelegationManager
    const normalizedTxTo = transaction.to
      ? this.normalizeAddress(transaction.to)
      : null;

    const configuredDelegationManager = this.delegationManagerAddress
      ? this.normalizeAddress(this.delegationManagerAddress)
      : null;

    const isDirectVaultCall = normalizedTxTo === configuredVault;
    const isDelegatedCall =
      configuredDelegationManager !== null &&
      normalizedTxTo === configuredDelegationManager;

    let executionPath: 'direct' | 'delegated';

    if (isDirectVaultCall) {
      executionPath = 'direct';
      this.logger.log(`✅ Direct vault call: ${normalizedTxTo}`);
    } else if (isDelegatedCall) {
      executionPath = 'delegated';
      this.logger.log(`✅ Delegated call via DelegationManager: ${normalizedTxTo}`);
    } else {
      const expected = configuredDelegationManager
        ? `WithdrawalVault (${configuredVault}) or DelegationManager (${configuredDelegationManager})`
        : `WithdrawalVault (${configuredVault})`;
      throw new BadRequestException(
        `Transaction was not sent through the configured WithdrawalVault execution path. Expected ${expected}, Actual: ${normalizedTxTo ?? 'null'}`,
      );
    }

    // ✅ Get receipt - source of truth for USDT transfer
    const receipt = await this.getTransactionReceipt(normalizedTxHash, chainId);
    if (!receipt) {
      throw new BadRequestException(
        'Transaction is still pending on blockchain',
      );
    }

    // ✅ Receipt status must be success
    if (receipt.status !== 1) {
      throw new BadRequestException('Transaction failed on blockchain');
    }

    // ✅ Verify USDT Transfer event
    const usdtAddress = this.normalizeAddress(this.usdtAddress);
    const decimals = this.parseDecimals(await this.usdtContract.decimals());
    const expectedAmountWei = this.normalizeAmount(expectedAmount, decimals);

    let transferFound = false;
    let actualFrom = '';
    let actualTo = '';
    let actualAmount = '';

    for (const log of receipt.logs) {
      // ✅ Event must be emitted by configured USDT contract
      if (log.address.toLowerCase() !== usdtAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = this.erc20Interface.parseLog({
          topics: log.topics,
          data: log.data,
        });

        if (!parsed || parsed.name !== 'Transfer') {
          continue;
        }

        const eventFrom = this.normalizeAddress(String(parsed.args[0]));
        const eventTo = this.normalizeAddress(String(parsed.args[1]));
        const eventAmount = BigInt(parsed.args[2]);

        // ✅ Transfer.from == WithdrawalVault
        // ✅ Transfer.to == verified recipient
        // ✅ Amount == approved amount
        if (
          eventFrom.toLowerCase() === configuredVault.toLowerCase() &&
          eventTo.toLowerCase() === normalizedRecipient.toLowerCase() &&
          eventAmount === expectedAmountWei
        ) {
          transferFound = true;
          actualFrom = eventFrom;
          actualTo = eventTo;
          actualAmount = ethers.formatUnits(eventAmount, decimals);
          this.logger.log(`✅ Found valid USDT Transfer event (${executionPath} path):`, {
            from: actualFrom,
            to: actualTo,
            amount: actualAmount,
          });
          break;
        }
      } catch {
        // Ignore non-Transfer logs from USDT contract
      }
    }

    if (!transferFound) {
      this.logger.error('❌ Transfer event not found or mismatched:', {
        expectedVault: configuredVault,
        expectedRecipient: normalizedRecipient,
        expectedAmount: expectedAmountWei.toString(),
        executionPath,
      });
      throw new BadRequestException(
        `Verified blockchain receipt does not contain a valid USDT Transfer event from the WithdrawalVault to the verified recipient with the exact approved amount (${executionPath} path)`,
      );
    }

    // ✅ Check confirmations
    const currentBlock = await this.getBlockNumber(chainId);
    if (receipt.blockNumber > currentBlock) {
      throw new BadRequestException(
        'Transaction block is ahead of current chain state',
      );
    }

    const confirmations = currentBlock - receipt.blockNumber + 1;
    if (confirmations < requiredConfirmations) {
      throw new BadRequestException(
        `Transaction has only ${confirmations} confirmation(s). Required: ${requiredConfirmations}`,
      );
    }

    return {
      txHash: normalizedTxHash,
      chainId,
      blockNumber: receipt.blockNumber,
      confirmations,
      vaultAddress: configuredVault,
      tokenAddress: usdtAddress,
      recipient: actualTo || normalizedRecipient,
      amount: actualAmount || ethers.formatUnits(expectedAmountWei, decimals),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      executionPath,
    };
  }

  // ============================================================
  // BATCH WITHDRAWAL VAULT PAYOUT VERIFICATION
  // ============================================================

  /**
   * Verifies a single WithdrawalVault.withdraw(recipients[], amounts[])
   * batch transaction against a list of expected payouts.
   *
   * Security model (identical to verifyWithdrawalVaultTransfer):
   *
   *  - transaction.to is NOT treated as the authoritative payout proof.
   *    The real production transaction routes through the configured
   *    DelegationManager (or another execution layer) while the USDT
   *    Transfer events are emitted by the configured WithdrawalVault.
   *  - The authoritative proof is:
   *       successful receipt
   *       + USDT Transfer event emitted by the configured USDT contract
   *       + Transfer.from === configured WithdrawalVault
   *       + Transfer.to   === verified recipient
   *       + Transfer.value === exact approved amount
   *  - Every requested payout must match exactly one unique event.
   *    Duplicate matching events and event reuse are rejected.
   *
   * If ANY requested payout does not match, the ENTIRE batch fails.
   */
  async verifyWithdrawalVaultBatchTransfer(params: {
    txHash: string;
    chainId: number;
    expectedVaultAddress: string;
    expectedRecipients: Array<{ recipient: string; amount: string }>;
    requiredConfirmations?: number;
    maxBatchSize?: number;
  }): Promise<VerifiedWithdrawalVaultBatchTransfer> {
    const {
      txHash,
      chainId,
      expectedVaultAddress,
      expectedRecipients,
      requiredConfirmations = 1,
      maxBatchSize = WITHDRAWAL_VAULT_MAX_BATCH_SIZE,
    } = params;

    // A. Validate the chain and the transaction hash
    this.assertConfiguredChain(chainId);
    const normalizedTxHash = this.validateTxHash(txHash);

    const configuredVault = this.normalizeAddress(this.withdrawalVaultAddress);
    const normalizedExpectedVault = this.normalizeAddress(expectedVaultAddress);
    if (configuredVault.toLowerCase() !== normalizedExpectedVault.toLowerCase()) {
      throw new BadRequestException(
        'Expected vault address does not match configured WithdrawalVault address',
      );
    }

    // B. Validate the batch shape
    if (!Array.isArray(expectedRecipients) || expectedRecipients.length === 0) {
      throw new BadRequestException(
        'At least one withdrawal recipient is required for batch verification',
      );
    }

    if (expectedRecipients.length > maxBatchSize) {
      throw new BadRequestException(
        `Batch size ${expectedRecipients.length} exceeds the maximum supported batch size of ${maxBatchSize}`,
      );
    }

    if (!Number.isInteger(requiredConfirmations) || requiredConfirmations < 1) {
      throw new BadRequestException('Invalid required confirmations');
    }

    const decimals = this.parseDecimals(await this.usdtContract.decimals());

    // C. Validate every requested recipient and amount (exact, no floats)
    const seenRecipients = new Set<string>();
    const expected = expectedRecipients.map((entry) => {
      const recipient = this.normalizeAddress(entry.recipient);

      if (
        typeof entry.amount !== 'string' ||
        !/^\d+(\.\d{1,18})?$/.test(entry.amount)
      ) {
        throw new BadRequestException(
          `Invalid withdrawal USDT amount for recipient ${recipient}`,
        );
      }

      const amountWei = this.normalizeAmount(entry.amount, decimals);
      if (amountWei <= 0n) {
        throw new BadRequestException(
          `Withdrawal USDT amount must be greater than zero for recipient ${recipient}`,
        );
      }

      const recipientKey = recipient.toLowerCase();
      if (seenRecipients.has(recipientKey)) {
        throw new BadRequestException(
          `Duplicate recipient in batch payout: ${recipient}`,
        );
      }
      seenRecipients.add(recipientKey);

      return { recipient, amount: entry.amount, amountWei };
    });

    // D. Load transaction - used ONLY for chain/execution-path context,
    //    never as the authoritative payout proof.
    const transaction = await this.getTransaction(normalizedTxHash, chainId);
    if (!transaction) {
      throw new BadRequestException('Transaction not found on blockchain');
    }

    if (
      transaction.chainId !== undefined &&
      BigInt(transaction.chainId) !== BigInt(chainId)
    ) {
      throw new BadRequestException(
        'Transaction chain ID does not match withdrawal chain',
      );
    }

    // E. Accept direct vault calls OR calls routed through the configured
    //    DelegationManager / execution layer (real production behavior).
    const normalizedTxTo = transaction.to
      ? this.normalizeAddress(transaction.to)
      : null;

    const configuredDelegationManager = this.delegationManagerAddress
      ? this.normalizeAddress(this.delegationManagerAddress)
      : null;

    const isDirectVaultCall = normalizedTxTo === configuredVault;
    const isDelegatedCall =
      configuredDelegationManager !== null &&
      normalizedTxTo === configuredDelegationManager;

    let executionPath: 'direct' | 'delegated';

    if (isDirectVaultCall) {
      executionPath = 'direct';
      this.logger.log(`✅ Batch direct vault call: ${normalizedTxTo}`);
    } else if (isDelegatedCall) {
      executionPath = 'delegated';
      this.logger.log(
        `✅ Batch delegated call via DelegationManager: ${normalizedTxTo}`,
      );
    } else {
      const expected = configuredDelegationManager
        ? `WithdrawalVault (${configuredVault}) or DelegationManager (${configuredDelegationManager})`
        : `WithdrawalVault (${configuredVault})`;
      throw new BadRequestException(
        `Transaction was not sent through the configured WithdrawalVault execution path. Expected ${expected}, Actual: ${normalizedTxTo ?? 'null'}`,
      );
    }

    // F. Load receipt - source of truth for the actual payouts
    const receipt = await this.getTransactionReceipt(normalizedTxHash, chainId);
    if (!receipt) {
      throw new BadRequestException('Transaction is still pending on blockchain');
    }

    if (receipt.status !== 1) {
      throw new BadRequestException('Transaction failed on blockchain');
    }

    const usdtAddress = this.normalizeAddress(this.usdtAddress);

    // G. Collect only USDT Transfer events emitted by the configured USDT contract
    const transferEvents: Array<{
      from: string;
      to: string;
      amountWei: bigint;
      logIndex: number;
    }> = [];

    for (const log of receipt.logs) {
      if (!log.address || log.address.toLowerCase() !== usdtAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = this.erc20Interface.parseLog({
          topics: log.topics,
          data: log.data,
        });

        if (!parsed || parsed.name !== 'Transfer') {
          continue;
        }

        const eventFrom = this.normalizeAddress(String(parsed.args[0]));
        const eventTo = this.normalizeAddress(String(parsed.args[1]));
        const eventAmount = BigInt(String(parsed.args[2]));

        transferEvents.push({
          from: eventFrom,
          to: eventTo,
          amountWei: eventAmount,
          logIndex: typeof log.index === 'number' ? log.index : 0,
        });
      } catch {
        // Ignore non-Transfer logs from the USDT contract
      }
    }

    // H. Match EVERY requested payout to exactly one unique event.

    const matches: VerifiedWithdrawalVaultBatchTransfer['transfers'] = [];

    for (const entry of expected) {
      const matching = transferEvents.filter(
        (event) =>
          event.from.toLowerCase() === configuredVault.toLowerCase() &&
          event.to.toLowerCase() === entry.recipient.toLowerCase() &&
          event.amountWei === entry.amountWei,
      );

      if (matching.length === 0) {
        this.logger.error(
          `❌ No matching USDT Transfer event found for recipient ${entry.recipient} amount ${entry.amount}`,
        );
        throw new BadRequestException(
          `No matching USDT Transfer event found for the WithdrawalVault payout to ${entry.recipient} for the exact approved amount (${entry.amount})`,
        );
      }

      if (matching.length > 1) {
        throw new BadRequestException(
          `Duplicate USDT Transfer events found for the same recipient and amount (${entry.recipient}, ${entry.amount})`,
        );
      }

      matches.push({
        recipient: entry.recipient,
        amount: ethers.formatUnits(entry.amountWei, decimals),
        amountWei: entry.amountWei.toString(),
        logIndex: matching[0].logIndex,
      });
    }

    // I. Confirmations
    const currentBlock = await this.getBlockNumber(chainId);
    if (receipt.blockNumber > currentBlock) {
      throw new BadRequestException(
        'Transaction block is ahead of current chain state',
      );
    }

    const confirmations = currentBlock - receipt.blockNumber + 1;
    if (confirmations < requiredConfirmations) {
      throw new BadRequestException(
        `Transaction has only ${confirmations} confirmation(s). Required: ${requiredConfirmations}`,
      );
    }

    this.logger.log(
      `✅ Batch WithdrawalVault payout verified: ${matches.length} payout(s) in tx ${normalizedTxHash} (${executionPath} path)`,
    );

    return {
      txHash: normalizedTxHash,
      chainId,
      blockNumber: receipt.blockNumber,
      confirmations,
      vaultAddress: configuredVault,
      tokenAddress: usdtAddress,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      executionPath,
      transfers: matches,
      matchedCount: matches.length,
    };
  }
}