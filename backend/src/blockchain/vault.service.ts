import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private provider: ethers.JsonRpcProvider;
  private vaultContract: ethers.Contract;
  private usdtContract: ethers.Contract;
  private signer: ethers.Wallet;

  private readonly VAULT_ABI = [
    'function depositUSDT(uint256 amount) external',
    'function requestWithdrawal(bytes32 withdrawalId, address user, uint256 amount) external returns (uint256)',
    'function executeWithdrawal(uint256 requestId, bytes32 withdrawalId) external',
    'function cancelWithdrawal(uint256 requestId) external',
    'function getVaultBalance() external view returns (uint256)',
    'function getWithdrawalRequest(uint256 requestId) external view returns (bytes32, address, uint256, uint256, bool)',
    'function isWithdrawalProcessed(bytes32 withdrawalId) external view returns (bool)',
    'function pause() external',
    'function unpause() external',
    'function withdrawExcess(uint256 amount) external',
    'function addFunds(uint256 amount) external',
    'function setTreasuryWallet(address _newTreasury) external',
    'event Deposit(address indexed user, uint256 amount)',
    'event WithdrawalRequested(uint256 indexed requestId, bytes32 indexed withdrawalId, address indexed user, uint256 amount)',
    'event WithdrawalExecuted(uint256 indexed requestId, bytes32 indexed withdrawalId, address indexed user, uint256 amount)',
  ];

  private readonly USDT_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
    'function transfer(address to, uint256 amount) external returns (bool)',
  ];

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    const privateKey = this.configService.get<string>('ADMIN_PRIVATE_KEY');
    if (privateKey) {
      this.signer = new ethers.Wallet(privateKey, this.provider);
    }

    const vaultAddress = this.configService.get<string>('TRADEX_VAULT_ADDRESS');
    const usdtAddress = this.configService.get<string>('BSC_USDT_ADDRESS');

    if (!vaultAddress || !usdtAddress) {
      this.logger.error('Vault or USDT address not configured');
      return;
    }

    const signerOrProvider = this.signer || this.provider;
    this.vaultContract = new ethers.Contract(
      vaultAddress,
      this.VAULT_ABI,
      signerOrProvider,
    );
    this.usdtContract = new ethers.Contract(
      usdtAddress,
      this.USDT_ABI,
      signerOrProvider,
    );

    this.logger.log(`✅ Vault Service initialized`);
    this.logger.log(`📋 Vault Address: ${vaultAddress}`);
    this.logger.log(`📋 USDT Address: ${usdtAddress}`);
  }

  // ============================================================
  // VIEW FUNCTIONS
  // ============================================================

  async getVaultBalance(): Promise<string> {
    try {
      const balance = await this.vaultContract.getVaultBalance();
      return ethers.formatUnits(balance, 18);
    } catch (error) {
      this.logger.error('Error getting vault balance:', error);
      return '0';
    }
  }

  async getUSDTBalance(address: string): Promise<string> {
    try {
      const balance = await this.usdtContract.balanceOf(address);
      return ethers.formatUnits(balance, 18);
    } catch (error) {
      this.logger.error('Error getting USDT balance:', error);
      return '0';
    }
  }

  async isWithdrawalProcessed(withdrawalId: string): Promise<boolean> {
    try {
      const id = ethers.keccak256(ethers.toUtf8Bytes(withdrawalId));
      return await this.vaultContract.isWithdrawalProcessed(id);
    } catch (error) {
      this.logger.error('Error checking withdrawal status:', error);
      return false;
    }
  }

  async getWithdrawalRequest(requestId: number): Promise<any> {
    try {
      const request = await this.vaultContract.getWithdrawalRequest(requestId);
      return {
        withdrawalId: request[0],
        user: request[1],
        amount: ethers.formatUnits(request[2], 18),
        createdAt: new Date(Number(request[3]) * 1000),
        executed: request[4],
      };
    } catch (error) {
      this.logger.error('Error getting withdrawal request:', error);
      return null;
    }
  }

  // ============================================================
  // DEPOSIT FUNCTIONS
  // ============================================================

  async approveUSDT(
    spender: string,
    amount: string,
  ): Promise<{ txHash: string }> {
    try {
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await this.usdtContract.approve(spender, amountWei);
      const receipt = await tx.wait();
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error approving USDT:', error);
      throw error;
    }
  }

  async getUSDTAllowance(owner: string, spender: string): Promise<string> {
    try {
      const allowance = await this.usdtContract.allowance(owner, spender);
      return ethers.formatUnits(allowance, 18);
    } catch (error) {
      this.logger.error('Error getting allowance:', error);
      return '0';
    }
  }

  // ============================================================
  // WITHDRAWAL FUNCTIONS
  // ============================================================

  generateWithdrawalId(prefix: string): string {
    return ethers.keccak256(
      ethers.toUtf8Bytes(`${prefix}-${Date.now()}-${Math.random()}`),
    );
  }

  async requestWithdrawal(
    withdrawalId: string,
    userAddress: string,
    usdtAmount: string,
  ): Promise<{ requestId: number; txHash: string }> {
    try {
      const amount = ethers.parseUnits(usdtAmount, 18);
      const id = ethers.keccak256(ethers.toUtf8Bytes(withdrawalId));

      this.logger.log(
        `📤 Requesting withdrawal: ${usdtAmount} USDT for ${userAddress}`,
      );

      const tx = await this.vaultContract.requestWithdrawal(
        id,
        userAddress,
        amount,
      );
      const receipt = await tx.wait();

      const requestId = await this.getRequestIdFromReceipt(receipt);

      this.logger.log(`✅ Withdrawal requested: Request ID ${requestId}`);
      return { requestId, txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error requesting withdrawal:', error);
      throw error;
    }
  }

  async executeWithdrawal(
    requestId: number,
    withdrawalId: string,
  ): Promise<{ txHash: string }> {
    try {
      const id = ethers.keccak256(ethers.toUtf8Bytes(withdrawalId));

      this.logger.log(`📤 Executing withdrawal: Request ${requestId}`);

      const tx = await this.vaultContract.executeWithdrawal(requestId, id);
      const receipt = await tx.wait();

      this.logger.log(`✅ Withdrawal executed: ${receipt.transactionHash}`);
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error executing withdrawal:', error);
      throw error;
    }
  }

  async cancelWithdrawal(requestId: number): Promise<{ txHash: string }> {
    try {
      this.logger.log(`📤 Cancelling withdrawal: Request ${requestId}`);

      const tx = await this.vaultContract.cancelWithdrawal(requestId);
      const receipt = await tx.wait();

      this.logger.log(`✅ Withdrawal cancelled: ${receipt.transactionHash}`);
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error cancelling withdrawal:', error);
      throw error;
    }
  }

  // ============================================================
  // ADMIN FUND MANAGEMENT
  // ============================================================

  async withdrawExcess(amount: string): Promise<{ txHash: string }> {
    try {
      const amountWei = ethers.parseUnits(amount, 18);
      const tx = await this.vaultContract.withdrawExcess(amountWei);
      const receipt = await tx.wait();
      this.logger.log(`💰 Excess funds withdrawn: ${amount} USDT`);
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error withdrawing excess:', error);
      throw error;
    }
  }

  // ✅ FIXED: addFunds with undefined check
  async addFunds(amount: string): Promise<{ txHash: string }> {
    try {
      const amountWei = ethers.parseUnits(amount, 18);
      const vaultAddress = this.configService.get<string>(
        'TRADEX_VAULT_ADDRESS',
      );

      // ✅ Check if vaultAddress is defined
      if (!vaultAddress) {
        throw new Error('Vault address not configured');
      }

      // First approve vault to spend USDT from treasury
      await this.approveUSDT(vaultAddress, amount);

      const tx = await this.vaultContract.addFunds(amountWei);
      const receipt = await tx.wait();

      this.logger.log(`💰 Funds added: ${amount} USDT`);
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error adding funds:', error);
      throw error;
    }
  }

  async setTreasuryWallet(newTreasury: string): Promise<{ txHash: string }> {
    try {
      const tx = await this.vaultContract.setTreasuryWallet(newTreasury);
      const receipt = await tx.wait();
      this.logger.log(`🏦 Treasury wallet updated: ${newTreasury}`);
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error setting treasury wallet:', error);
      throw error;
    }
  }

  // ============================================================
  // EMERGENCY FUNCTIONS
  // ============================================================

  async pauseVault(): Promise<{ txHash: string }> {
    try {
      const tx = await this.vaultContract.pause();
      const receipt = await tx.wait();
      this.logger.log('⏸️ Vault paused');
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error pausing vault:', error);
      throw error;
    }
  }

  async unpauseVault(): Promise<{ txHash: string }> {
    try {
      const tx = await this.vaultContract.unpause();
      const receipt = await tx.wait();
      this.logger.log('▶️ Vault unpaused');
      return { txHash: receipt.transactionHash };
    } catch (error) {
      this.logger.error('Error unpausing vault:', error);
      throw error;
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  async listenForDeposits(callback: (user: string, amount: string) => void) {
    this.vaultContract.on('Deposit', (user: string, amount: bigint) => {
      this.logger.log(
        `💰 Deposit event: ${ethers.formatUnits(amount, 18)} USDT from ${user}`,
      );
      callback(user, ethers.formatUnits(amount, 18));
    });
  }

  async listenForWithdrawals(
    callback: (
      requestId: number,
      withdrawalId: string,
      user: string,
      amount: string,
    ) => void,
  ) {
    this.vaultContract.on(
      'WithdrawalExecuted',
      (
        requestId: bigint,
        withdrawalId: string,
        user: string,
        amount: bigint,
      ) => {
        this.logger.log(
          `📤 Withdrawal event: ${ethers.formatUnits(amount, 18)} USDT to ${user}`,
        );
        callback(
          Number(requestId),
          withdrawalId,
          user,
          ethers.formatUnits(amount, 18),
        );
      },
    );
  }

  async listenForWithdrawalRequests(
    callback: (
      requestId: number,
      withdrawalId: string,
      user: string,
      amount: string,
    ) => void,
  ) {
    this.vaultContract.on(
      'WithdrawalRequested',
      (
        requestId: bigint,
        withdrawalId: string,
        user: string,
        amount: bigint,
      ) => {
        this.logger.log(
          `📤 Withdrawal request event: ${ethers.formatUnits(amount, 18)} USDT for ${user}`,
        );
        callback(
          Number(requestId),
          withdrawalId,
          user,
          ethers.formatUnits(amount, 18),
        );
      },
    );
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async getRequestIdFromReceipt(receipt: any): Promise<number> {
    const iface = this.vaultContract.interface;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'WithdrawalRequested') {
          return Number(parsed.args.requestId);
        }
      } catch {
        continue;
      }
    }
    throw new Error('Request ID not found in receipt');
  }
}
