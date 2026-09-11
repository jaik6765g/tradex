// backend/src/modules/deposits/deposit.service.ts

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { Deposit, DepositStatus } from './deposit.entity';
import { BalanceService } from '../balances/balance.service';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerType } from '../ledger/ledger.entity';
import { BlockchainService } from '../blockchain/blockchain.service';

interface CountVolumeMetric {
  count: number;
  volume: string;
}

interface DepositVaultSnapshot {
  balance: string | null;
  symbol: 'USDT';
  chainId: number | null;
  address: string | null;
  tokenAddress: string | null;
  fetchedAt: string;
  available: boolean;
  error?: string;
}

export interface DepositAdminStatistics {
  total: CountVolumeMetric;
  today: CountVolumeMetric;
  statuses: {
    pending: number;
    confirming: number;
    verified: number;
    completed: number;
    failed: number;
  };
  vault: DepositVaultSnapshot;
}

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    @InjectRepository(Deposit)
    private depositRepository: Repository<Deposit>,
    private balanceService: BalanceService,
    private ledgerService: LedgerService,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
  ) {}

  // ============================================================
  // CREATE & UPDATE
  // ============================================================

  async createDeposit(depositData: Partial<Deposit>): Promise<Deposit> {
    const existing = await this.depositRepository.findOne({
      where: { transactionHash: depositData.transactionHash },
    });

    if (existing) {
      throw new ConflictException('Transaction already processed');
    }

    const deposit = this.depositRepository.create({
      ...depositData,
      status: DepositStatus.PENDING,
      detectedAt: new Date(),
    });

    return this.depositRepository.save(deposit);
  }

  async updateConfirmations(
    depositId: string,
    confirmations: number,
  ): Promise<Deposit> {
    const deposit = await this.getDepositById(depositId);

    deposit.confirmations = confirmations;

    if (
      confirmations >= deposit.requiredConfirmations &&
      (deposit.status === DepositStatus.PENDING ||
        deposit.status === DepositStatus.CONFIRMING)
    ) {
      deposit.status = DepositStatus.VERIFIED;
      deposit.confirmedAt = new Date();
    }

    return this.depositRepository.save(deposit);
  }

  async creditDeposit(depositId: string): Promise<Deposit> {
    const deposit = await this.getDepositById(depositId);

    if (deposit.status === DepositStatus.COMPLETED) {
      throw new ConflictException('Deposit already credited');
    }

    if (deposit.status !== DepositStatus.VERIFIED) {
      throw new ConflictException('Deposit not verified yet');
    }

    const tdxAmount = Number(deposit.tdxAmount);

    if (!Number.isFinite(tdxAmount) || tdxAmount <= 0) {
      throw new Error(`Invalid TDX amount: ${tdxAmount}`);
    }

    await this.balanceService.creditTDX(
      deposit.userId,
      tdxAmount,
      LedgerType.DEPOSIT,
      `Deposit of ${deposit.usdtAmount} USDT converted to ${tdxAmount} TDX`,
      deposit.id,
      {
        usdtAmount: deposit.usdtAmount,
        rate: 100,
        transactionHash: deposit.transactionHash,
        chainId: deposit.chainId,
      },
    );

    deposit.status = DepositStatus.COMPLETED;
    deposit.creditedAt = new Date();

    return this.depositRepository.save(deposit);
  }

  // ============================================================
  // GETTERS
  // ============================================================

  async getDepositByTransactionHash(txHash: string): Promise<Deposit | null> {
    return this.depositRepository.findOne({
      where: { transactionHash: txHash },
    });
  }

  async getDepositById(id: string): Promise<Deposit> {
    const deposit = await this.depositRepository.findOne({
      where: { id },
    });

    if (!deposit) {
      throw new NotFoundException('Deposit not found');
    }

    return deposit;
  }

  async getUserDeposits(userId: string): Promise<Deposit[]> {
    return this.depositRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * GET USER DEPOSITS WITH PAGINATION
   * 
   * Returns paginated list of deposits for a specific user.
   * Used by the frontend transactions screen.
   */
  async getUserDepositsPaginated(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{
    data: Deposit[];
    total: number;
    limit: number;
    offset: number;
  }> {
    // ✅ Validate userId
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const [data, total] = await this.depositRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return {
      data,
      total,
      limit,
      offset,
    };
  }

  async getPendingDeposits(): Promise<Deposit[]> {
    return this.depositRepository.find({
      where: [
        { status: DepositStatus.PENDING },
        { status: DepositStatus.CONFIRMING },
        { status: DepositStatus.VERIFIED },
      ],
      order: { createdAt: 'ASC' },
    });
  }

  // ============================================================
  // ADMIN - ALL DEPOSITS WITH PAGINATION
  // ============================================================

  async getAllDeposits(params: {
    limit: number;
    offset: number;
    status?: DepositStatus;
    search?: string;
  }): Promise<{
    data: Deposit[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const where: FindOptionsWhere<Deposit> = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      const search = params.search.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
      const isTxHash = /^0x[a-fA-F0-9]{64}$/i.test(search);
      const isNumeric = /^\d+$/.test(search);

      if (isUuid) {
        where.id = search;
      } else if (isTxHash) {
        where.transactionHash = search;
      } else if (isNumeric) {
        where.chainId = parseInt(search);
      } else {
        where.userId = Like(`%${search}%`);
      }
    }

    const [data, total] = await this.depositRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: params.offset,
      take: params.limit,
    });

    return {
      data,
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  // ============================================================
  // ADMIN - UPDATE STATUS
  // ============================================================

  async updateDepositStatus(
    depositId: string,
    status: DepositStatus,
    reason?: string,
  ): Promise<Deposit> {
    const deposit = await this.getDepositById(depositId);

    deposit.status = status;
    if (reason) {
      deposit.metadata = {
        ...deposit.metadata,
        statusChangeReason: reason,
        statusChangedAt: new Date().toISOString(),
      };
    }

    return this.depositRepository.save(deposit);
  }

  // ============================================================
  // STATISTICS
  // ============================================================

  async getDepositStatistics(): Promise<DepositAdminStatistics> {
    const aggregate = await this.depositRepository
      .createQueryBuilder('deposit')
      .select(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus THEN 1 ELSE 0 END), 0)`,
        'total_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus THEN deposit.usdt_amount ELSE 0 END), 0)`,
        'total_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus AND deposit.credited_at >= CURRENT_DATE AND deposit.credited_at < CURRENT_DATE + INTERVAL '1 day' THEN 1 ELSE 0 END), 0)`,
        'today_completed_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :completedStatus AND deposit.credited_at >= CURRENT_DATE AND deposit.credited_at < CURRENT_DATE + INTERVAL '1 day' THEN deposit.usdt_amount ELSE 0 END), 0)`,
        'today_completed_volume',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :pendingStatus THEN 1 ELSE 0 END), 0)`,
        'pending_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :confirmingStatus THEN 1 ELSE 0 END), 0)`,
        'confirming_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :verifiedStatus THEN 1 ELSE 0 END), 0)`,
        'verified_count',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN deposit.status = :failedStatus THEN 1 ELSE 0 END), 0)`,
        'failed_count',
      )
      .setParameters({
        completedStatus: DepositStatus.COMPLETED,
        pendingStatus: DepositStatus.PENDING,
        confirmingStatus: DepositStatus.CONFIRMING,
        verifiedStatus: DepositStatus.VERIFIED,
        failedStatus: DepositStatus.FAILED,
      })
      .getRawOne<{
        total_completed_count: string;
        total_completed_volume: string;
        today_completed_count: string;
        today_completed_volume: string;
        pending_count: string;
        confirming_count: string;
        verified_count: string;
        failed_count: string;
      }>();

    const vault = await this.getDepositVaultSnapshot();

    return {
      total: {
        count: this.toCount(aggregate?.total_completed_count),
        volume: this.toAmount(aggregate?.total_completed_volume),
      },
      today: {
        count: this.toCount(aggregate?.today_completed_count),
        volume: this.toAmount(aggregate?.today_completed_volume),
      },
      statuses: {
        pending: this.toCount(aggregate?.pending_count),
        confirming: this.toCount(aggregate?.confirming_count),
        verified: this.toCount(aggregate?.verified_count),
        completed: this.toCount(aggregate?.total_completed_count),
        failed: this.toCount(aggregate?.failed_count),
      },
      vault,
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async getDepositVaultSnapshot(): Promise<DepositVaultSnapshot> {
    const configuredChainId = this.configService.get<string>('BSC_CHAIN_ID');
    const chainId = Number(configuredChainId ?? '56');
    const normalizedChainId =
      Number.isInteger(chainId) && chainId > 0 ? chainId : null;
    const configuredVaultAddress =
      this.configService.get<string>('TRADEX_VAULT_ADDRESS')?.trim() || null;
    const configuredTokenAddress =
      this.configService.get<string>('BSC_USDT_ADDRESS')?.trim() || null;
    const fetchedAt = new Date().toISOString();

    if (!normalizedChainId) {
      return {
        balance: null,
        symbol: 'USDT',
        chainId: null,
        address: configuredVaultAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }

    try {
      const [balance, address, tokenAddress] = await Promise.all([
        this.blockchainService.getVaultUsdtBalance(normalizedChainId),
        Promise.resolve(
          this.blockchainService.getVaultAddress(normalizedChainId),
        ),
        Promise.resolve(
          this.blockchainService.getUsdtAddress(normalizedChainId),
        ),
      ]);

      return {
        balance,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address,
        tokenAddress,
        fetchedAt,
        available: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch deposit vault balance: ${message}`);

      return {
        balance: null,
        symbol: 'USDT',
        chainId: normalizedChainId,
        address: configuredVaultAddress,
        tokenAddress: configuredTokenAddress,
        fetchedAt,
        available: false,
        error: 'Blockchain data unavailable',
      };
    }
  }

  private toCount(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toAmount(value: string | number | null | undefined): string {
    const raw = value === null || value === undefined ? '0' : String(value);
    return /^[-+]?\d+(\.\d+)?$/.test(raw.trim()) ? raw : '0';
  }
}