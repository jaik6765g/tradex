// backend/src/modules/bot/bot.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';

import { BotAccount, BotAccountStatus } from './entities/bot-account.entity';
import { BotWallet } from './entities/bot-wallet.entity';
import { BotActivation, BotActivationStatus } from './entities/bot-activation.entity';
import { BotSetting } from './entities/bot-setting.entity';
import { Balance } from '../balances/balance.entity';
import { User } from '../users/user.entity';
import { LedgerEntry, LedgerType } from '../ledger/ledger.entity';
import { WalletSourceService } from '../wagering/wallet-source.service';
import { FUND_SOURCE_TYPE } from '../wagering/wagering-source';
import {
  BotWalletTransaction,
  BotWalletTransactionStatus,
  BotWalletTransactionType,
} from './entities/bot-wallet-transaction.entity';
import { BotWalletTransferDirection } from './dto/transfer-bot-wallet.dto';
import { UpdateBotSettingsDto } from './dto/update-bot-settings.dto';
import { BotActivityFilter } from './dto/query-bot.dto';

export interface BotSettingsResponse {
  minimumActivation: string;
  maximumActivation: string;
  liquidityAllocationRate: string;
  firstReferralRate: string;
  firstReferralLevel1Rate: string;
  firstReferralLevel2Rate: string;
  firstReferralLevel3Rate: string;
  firstReferralLevel4Rate: string;
  firstReferralLevel5Rate: string;
  firstReferralLevel6Rate: string;
  firstReferralLevel1DirectRequired: number;
  firstReferralLevel2DirectRequired: number;
  firstReferralLevel3DirectRequired: number;
  firstReferralLevel4DirectRequired: number;
  firstReferralLevel5DirectRequired: number;
  firstReferralLevel6DirectRequired: number;
  updatedAt: string;
}

type BotActivityCategory = 'TRADE' | 'WALLET' | 'STATUS';
type BotActivityDirection = 'CREDIT' | 'DEBIT' | 'NEUTRAL';

type BotActivityItem = {
  id: string;
  type: BotWalletTransactionType;
  category: BotActivityCategory;
  title: string;
  description: string;
  amount: string;
  signedAmount: string;
  direction: BotActivityDirection;
  status: BotWalletTransactionStatus;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
};

@Injectable()
export class BotService {
  constructor(
    private readonly dataSource: DataSource,
    /**
     * FIFO attribution. Bot first-activation referral payouts are referral
     * commission: NON-wagerable, never create a wagering obligation, and
     * remain withdrawable during active deposit wagering.
     */
    private readonly walletSourceService: WalletSourceService,
  ) {}

  // ============================================================
  // CREATE BOT ACCOUNT
  // ============================================================

  async createBotAccount(userId: string): Promise<BotAccount> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager
        .getRepository(BotAccount)
        .createQueryBuilder('bot')
        .setLock('pessimistic_read')
        .where('bot.user_id = :userId', { userId })
        .getOne();

      if (existing) {
        return this.loadBotAccount(manager, existing.id);
      }

      const botId = await this.generateNextBotId(manager);

      const botAccount = manager.create(BotAccount, {
        userId,
        botId,
        status: BotAccountStatus.INACTIVE,
        principal: '0',
        activatedAt: null,
        suspendedAt: null,
        closedAt: null,
      });

      let savedAccount: BotAccount;

      try {
        savedAccount = await manager.save(BotAccount, botAccount);
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          const concurrent = await manager.getRepository(BotAccount).findOne({
            where: { userId },
          });

          if (concurrent) {
            return this.loadBotAccount(manager, concurrent.id);
          }
        }
        throw error;
      }

      const botWallet = manager.create(BotWallet, {
        botAccountId: savedAccount.id,
        availableBalance: '0',
        lockedBalance: '0',
        totalBalance: '0',
      });

      await manager.save(BotWallet, botWallet);

      return this.loadBotAccount(manager, savedAccount.id);
    });
  }

  // ============================================================
  // GET BOT ACCOUNT
  // ============================================================

  async getBotAccount(userId: string): Promise<BotAccount> {
    const botAccount = await this.dataSource.getRepository(BotAccount).findOne({
      where: { userId },
      relations: {
        botWallet: true,
      },
    });

    if (!botAccount) {
      throw new NotFoundException('Bot account not found');
    }

    return botAccount;
  }

  // ============================================================
  // GET BOT ACTIVITY - ✅ FIXED
  // ============================================================

  async getBotActivity(
    userId: string,
    query?: {
      page?: number;
      limit?: number;
      filter?: BotActivityFilter;
    },
  ): Promise<{
    items: BotActivityItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const page = this.normalizePage(query?.page);
    const limit = this.normalizeLimit(query?.limit);
    const filter = query?.filter ?? BotActivityFilter.ALL;

    // ✅ Get bot account - return empty if not found
    const botAccount = await this.dataSource.getRepository(BotAccount).findOne({
      where: { userId },
    });

    if (!botAccount) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      };
    }

    const botWallet = await this.dataSource.getRepository(BotWallet).findOne({
      where: { botAccountId: botAccount.id },
    });

    if (!botWallet) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      };
    }

    const transactionRepository = this.dataSource.getRepository(BotWalletTransaction);

    const queryBuilder = transactionRepository
      .createQueryBuilder('tx')
      .where('tx.bot_wallet_id = :botWalletId', {
        botWalletId: botWallet.id,
      });

    const filteredTypes = this.resolveActivityTypes(filter);

    if (filteredTypes.length > 0) {
      queryBuilder.andWhere('tx.type IN (:...types)', {
        types: filteredTypes,
      });
    }

    const total = await queryBuilder.getCount();

    const transactions = await queryBuilder
      .clone()
      .orderBy('tx.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const items = transactions.map((transaction) =>
      this.mapTransactionToActivity(transaction),
    );

    return {
      items,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  // ============================================================
  // TRANSFER TO BOT WALLET - ✅ FIXED
  // ============================================================

  async transferToBotWallet(
    userId: string,
    amount: string,
    direction: BotWalletTransferDirection,
  ): Promise<BotWallet> {
    return this.dataSource.transaction(async (manager) => {
      if (
        direction !== BotWalletTransferDirection.TRANSFER_IN &&
        direction !== BotWalletTransferDirection.TRANSFER_OUT
      ) {
        throw new BadRequestException(
          'Transfer direction must be TRANSFER_IN or TRANSFER_OUT',
        );
      }

      let numericAmount: Decimal;

      try {
        numericAmount = new Decimal(amount);
      } catch {
        throw new BadRequestException(
          'Transfer amount must be a valid decimal amount',
        );
      }

      if (!numericAmount.isFinite() || !numericAmount.gt(0)) {
        throw new BadRequestException(
          'Transfer amount must be greater than zero',
        );
      }

      const balance = await manager
        .getRepository(Balance)
        .createQueryBuilder('balance')
        .setLock('pessimistic_write')
        .where('balance.user_id = :userId', { userId })
        .getOne();

      if (!balance) {
        throw new NotFoundException('User balance not found');
      }

      const botAccount = await manager
        .getRepository(BotAccount)
        .createQueryBuilder('bot')
        .setLock('pessimistic_write')
        .where('bot.user_id = :userId', { userId })
        .getOne();

      if (!botAccount) {
        throw new NotFoundException('Bot account not found');
      }

      const botWallet = await manager
        .getRepository(BotWallet)
        .createQueryBuilder('wallet')
        .setLock('pessimistic_write')
        .where('wallet.bot_account_id = :botAccountId', {
          botAccountId: botAccount.id,
        })
        .getOne();

      if (!botWallet) {
        throw new NotFoundException('Bot wallet not found');
      }

      const availableBalance = new Decimal(balance.availableBalance);
      const botAvailableBalance = new Decimal(botWallet.availableBalance);

      const isTransferOut = direction === BotWalletTransferDirection.TRANSFER_OUT;
      const botBefore = botWallet.availableBalance;

      if (!isTransferOut) {
        if (availableBalance.lt(numericAmount)) {
          throw new BadRequestException('Insufficient main wallet balance');
        }

        balance.availableBalance = availableBalance.minus(numericAmount).toFixed(18);
        balance.totalBalance = new Decimal(balance.totalBalance).minus(numericAmount).toFixed(18);

        botWallet.availableBalance = botAvailableBalance.plus(numericAmount).toFixed(18);
        botWallet.totalBalance = new Decimal(botWallet.totalBalance).plus(numericAmount).toFixed(18);
      } else {
        if (botAvailableBalance.lt(numericAmount)) {
          throw new BadRequestException('Insufficient Bot Wallet balance');
        }

        botWallet.availableBalance = botAvailableBalance.minus(numericAmount).toFixed(18);
        botWallet.totalBalance = new Decimal(botWallet.totalBalance).minus(numericAmount).toFixed(18);

        balance.availableBalance = availableBalance.plus(numericAmount).toFixed(18);
        balance.totalBalance = new Decimal(balance.totalBalance).plus(numericAmount).toFixed(18);
      }

      balance.lastUpdatedAt = new Date();

      await manager.save(Balance, balance);
      await manager.save(BotWallet, botWallet);

      const transaction = manager.create(BotWalletTransaction, {
        botWalletId: botWallet.id,
        type: isTransferOut
          ? BotWalletTransactionType.TRANSFER_OUT
          : BotWalletTransactionType.TRANSFER_IN,
        amount: numericAmount.toFixed(18),
        status: BotWalletTransactionStatus.COMPLETED,
        balanceBefore: botBefore,
        balanceAfter: botWallet.availableBalance,
        referenceType: isTransferOut
          ? 'BOT_WALLET_TRANSFER_OUT'
          : 'MAIN_BALANCE_TRANSFER',
        referenceId: botAccount.id,
        description: isTransferOut
          ? 'Transfer from Bot Wallet to Main Balance'
          : 'Transfer from Main Balance to Bot Wallet',
        metadata: {},
      });

      await manager.save(BotWalletTransaction, transaction);

      return botWallet;
    });
  }

  // ============================================================
  // ACTIVATE BOT
  // ============================================================

  async activateBot(
    userId: string,
    amount: string,
    idempotencyKey: string,
  ): Promise<BotActivation> {
    return this.dataSource.transaction(async (manager) => {
      let numericAmount: Decimal;

      try {
        numericAmount = new Decimal(amount);
      } catch {
        throw new BadRequestException(
          'Activation amount must be a valid decimal amount',
        );
      }

      if (!numericAmount.isFinite() || !numericAmount.gt(0)) {
        throw new BadRequestException(
          'Activation amount must be greater than zero',
        );
      }

      if (!idempotencyKey) {
        throw new BadRequestException('Idempotency key is required');
      }

      // Idempotency protection
      const existingActivation = await manager
        .getRepository(BotActivation)
        .findOne({
          where: { idempotencyKey },
        });

      if (existingActivation) {
        return existingActivation;
      }

      // Lock Bot Account
      const botAccount = await manager
        .getRepository(BotAccount)
        .createQueryBuilder('bot')
        .setLock('pessimistic_write')
        .where('bot.user_id = :userId', { userId })
        .getOne();

      if (!botAccount) {
        throw new NotFoundException('Bot account not found');
      }

      if (botAccount.status === BotAccountStatus.CLOSED) {
        throw new ConflictException('Bot account is closed');
      }

      if (botAccount.status === BotAccountStatus.SUSPENDED) {
        throw new ConflictException('Bot account is suspended');
      }

      // Lock Bot Wallet
      const botWallet = await manager
        .getRepository(BotWallet)
        .createQueryBuilder('wallet')
        .setLock('pessimistic_write')
        .where('wallet.bot_account_id = :botAccountId', {
          botAccountId: botAccount.id,
        })
        .getOne();

      if (!botWallet) {
        throw new NotFoundException('Bot wallet not found');
      }

      const walletBalance = new Decimal(botWallet.availableBalance);

      if (walletBalance.lt(numericAmount)) {
        throw new BadRequestException('Insufficient Bot Wallet balance');
      }

      // Load activation settings
      const setting = await manager
        .getRepository(BotSetting)
        .createQueryBuilder('setting')
        .orderBy('setting.created_at', 'DESC')
        .getOne();

      const minimumActivation = new Decimal(setting?.minimumActivation ?? '10000');
      const maximumActivation = new Decimal(setting?.maximumActivation ?? '1000000');
      const liquidityRate = new Decimal(setting?.liquidityAllocationRate ?? '90');
      const firstReferralRate = new Decimal(setting?.firstReferralRate ?? '10');

      if (numericAmount.lt(minimumActivation)) {
        throw new BadRequestException(
          `Minimum activation amount is ${minimumActivation.toFixed()}`,
        );
      }

      if (numericAmount.gt(maximumActivation)) {
        throw new BadRequestException(
          `Maximum activation amount is ${maximumActivation.toFixed()}`,
        );
      }

      if (liquidityRate.lt(0) || firstReferralRate.lt(0)) {
        throw new ConflictException('Invalid bot activation settings');
      }

      if (!liquidityRate.plus(firstReferralRate).eq(100)) {
        throw new ConflictException('Bot activation allocation must equal 100%');
      }

      // Calculate allocation
      const liquidityAmount = numericAmount.mul(liquidityRate).div(100).toFixed(18);
      const firstReferralReserve = numericAmount.mul(firstReferralRate).div(100).toFixed(18);

      const walletBefore = botWallet.availableBalance;

      botWallet.availableBalance = walletBalance.minus(numericAmount).toFixed(18);
      botWallet.totalBalance = new Decimal(botWallet.totalBalance).minus(numericAmount).toFixed(18);

      await manager.save(BotWallet, botWallet);

      // Determine first qualifying activation
      const previousActivation = await manager
        .getRepository(BotActivation)
        .createQueryBuilder('activation')
        .setLock('pessimistic_read')
        .where('activation.bot_account_id = :botAccountId', {
          botAccountId: botAccount.id,
        })
        .andWhere('activation.status = :status', {
          status: BotActivationStatus.ACTIVE,
        })
        .getOne();

      const isFirstQualifyingActivation = !previousActivation;

      // Create activation record
      const activation = manager.create(BotActivation, {
        botAccountId: botAccount.id,
        principal: numericAmount.toFixed(18),
        liquidityAmount,
        firstReferralReserve,
        status: BotActivationStatus.ACTIVE,
        isFirstQualifyingActivation,
        idempotencyKey,
        blockchainTxHash: null,
        activatedAt: new Date(),
        failureReason: null,
      });

      const savedActivation = await manager.save(BotActivation, activation);

      // Update Bot Account
      botAccount.status = BotAccountStatus.ACTIVE;
      botAccount.principal = new Decimal(botAccount.principal).plus(numericAmount).toFixed(18);

      if (!botAccount.activatedAt) {
        botAccount.activatedAt = new Date();
      }

      botAccount.suspendedAt = null;
      botAccount.closedAt = null;

      await manager.save(BotAccount, botAccount);

      // Wallet transaction ledger
      const walletTransaction = manager.create(BotWalletTransaction, {
        botWalletId: botWallet.id,
        type: BotWalletTransactionType.BOT_ACTIVATION,
        amount: numericAmount.toFixed(18),
        status: BotWalletTransactionStatus.COMPLETED,
        balanceBefore: walletBefore,
        balanceAfter: botWallet.availableBalance,
        referenceType: 'BOT_ACTIVATION',
        referenceId: savedActivation.id,
        description: 'Bot activation from Bot Wallet',
        metadata: {},
      });

      await manager.save(BotWalletTransaction, walletTransaction);

      // First qualifying activation: distribute the 10% referral reserve
      if (isFirstQualifyingActivation) {
        if (!setting) {
          throw new ConflictException('Bot activation settings not found');
        }
        await this.distributeFirstActivationReferral({
          manager,
          activation: savedActivation,
          referralReserve: firstReferralReserve,
          liquidityAmount,
          setting,
          userId,
        });
      }

      return savedActivation;
    });
  }

  // ============================================================
  // FIRST ACTIVATION REFERRAL DISTRIBUTION
  // ============================================================

  private async distributeFirstActivationReferral(input: {
    manager: EntityManager;
    activation: BotActivation;
    referralReserve: string;
    liquidityAmount: string;
    setting: BotSetting;
    userId: string;
  }): Promise<void> {
    const { manager, activation, referralReserve, liquidityAmount, setting, userId } =
      input;

    const levelRates: Decimal[] = [
      new Decimal(setting.firstReferralLevel1Rate ?? '6'),
      new Decimal(setting.firstReferralLevel2Rate ?? '1.5'),
      new Decimal(setting.firstReferralLevel3Rate ?? '1'),
      new Decimal(setting.firstReferralLevel4Rate ?? '0.6'),
      new Decimal(setting.firstReferralLevel5Rate ?? '0.5'),
      new Decimal(setting.firstReferralLevel6Rate ?? '0.4'),
    ];

    const firstReferralRate = new Decimal(setting.firstReferralRate ?? '10');
    const levelRateSum = levelRates.reduce((sum, rate) => sum.plus(rate), new Decimal(0));
    if (!levelRateSum.eq(firstReferralRate)) {
      throw new ConflictException(
        `BOT_FIRST_ACTIVATION_REFERRAL_RATE_MISMATCH: L1-L6 sum ${levelRateSum.toFixed()} != firstReferralRate ${firstReferralRate.toFixed()}`,
      );
    }

    const ancestors = await this.resolveReferralAncestors(manager, userId);
    let totalReferralPaid = new Decimal(0);
    let totalUnallocated = new Decimal(0);
    const activationRepo = manager.getRepository(BotActivation);
    const balanceRepo = manager.getRepository(Balance);

    for (let level = 1; level <= 6; level += 1) {
      const levelRate = levelRates[level - 1];
      const levelAmount = new Decimal(activation.principal).mul(levelRate).div(100).toFixed(18);
      const levelAmountDecimal = new Decimal(levelAmount);
      const referenceId = `${activation.id}:L${level}`;
      const ancestor = ancestors[level - 1];
      // Eligibility is per-level and per-recipient: the recipient qualifies
      // for this level only when their ACTIVE DIRECT Bot count is at least
      // the configured threshold for that level.
      const isEligible =
        Boolean(ancestor) &&
        (await this.isReferralLevelEligible(
          manager,
          ancestor.id,
          level,
          setting,
        ));

      if (isEligible) {
        const recipientBalance = await balanceRepo
          .createQueryBuilder('balance')
          .setLock('pessimistic_write')
          .where('balance.user_id = :recipientId', { recipientId: ancestor.id })
          .getOne();

        if (!recipientBalance) {
          const created = await this.getOrCreateBalance(manager, ancestor.id);
          const before = new Decimal(0);
          const after = before.plus(levelAmountDecimal);
          created.availableBalance = after.toFixed(18);
          created.totalBalance = after.toFixed(18);
          created.lastUpdatedAt = new Date();
          await balanceRepo.save(created);
          await this.saveReferralLedger(manager, {
            userId: ancestor.id,
            amount: levelAmount,
            balanceBefore: before.toFixed(18),
            balanceAfter: after.toFixed(18),
            referenceId,
            level,
            activationId: activation.id,
          });
        } else {
          const before = new Decimal(recipientBalance.availableBalance);
          const after = before.plus(levelAmountDecimal);
          recipientBalance.availableBalance = after.toFixed(18);
          recipientBalance.totalBalance = new Decimal(recipientBalance.totalBalance)
            .plus(levelAmountDecimal)
            .toFixed(18);
          recipientBalance.lastUpdatedAt = new Date();
          await balanceRepo.save(recipientBalance);
          await this.saveReferralLedger(manager, {
            userId: ancestor.id,
            amount: levelAmount,
            balanceBefore: before.toFixed(18),
            balanceAfter: after.toFixed(18),
            referenceId,
            level,
            activationId: activation.id,
          });
        }
        totalReferralPaid = totalReferralPaid.plus(levelAmountDecimal);
      } else {
        totalUnallocated = totalUnallocated.plus(levelAmountDecimal);
        const ledgerRepo = manager.getRepository(LedgerEntry);
        const liquidityEntry = ledgerRepo.create({
          userId,
          type: LedgerType.BOT_FIRST_ACTIVATION_LIQUIDITY,
          amount: levelAmount,
          balanceBefore: '0',
          balanceAfter: '0',
          referenceId: `${referenceId}:LIQUIDITY`,
          referenceType: 'BOT_FIRST_ACTIVATION_REFERRAL_LIQUIDITY',
          description: `Bot first activation L${level} unallocated to liquidity`,
          metadata: {
            activationId: activation.id,
            level,
            reason: ancestor ? 'INELIGIBLE' : 'NO_UPLINE',
            ancestorUserId: ancestor?.id ?? null,
            amount: levelAmount,
          },
        });
        await ledgerRepo.save(liquidityEntry);
      }
    }

    const accounted = totalReferralPaid.plus(totalUnallocated);
    if (!accounted.eq(new Decimal(referralReserve))) {
      throw new ConflictException(
        `BOT_FIRST_ACTIVATION_REFERRAL_RECONCILIATION_FAILED: reserve ${referralReserve} != paid ${totalReferralPaid.toFixed(18)} + unallocated ${totalUnallocated.toFixed(18)}`,
      );
    }

    const finalLiquidity = new Decimal(liquidityAmount).plus(totalUnallocated);
    activation.liquidityAmount = finalLiquidity.toFixed(18);
    await activationRepo.save(activation);
  }

  // ============================================================
  // ADMIN BOT SETTINGS
  // ============================================================

  async getBotSettings(): Promise<BotSettingsResponse> {
    const setting = await this.loadLatestBotSetting();
    return this.toBotSettingsResponse(setting);
  }

  async updateBotSettings(dto: UpdateBotSettingsDto): Promise<BotSettingsResponse> {
    const setting = await this.loadLatestBotSetting();

    const merged = {
      minimumActivation: dto.minimumActivation ?? setting.minimumActivation,
      maximumActivation: dto.maximumActivation ?? setting.maximumActivation,
      liquidityAllocationRate:
        dto.liquidityAllocationRate ?? setting.liquidityAllocationRate,
      firstReferralRate: dto.firstReferralRate ?? setting.firstReferralRate,
      firstReferralLevel1Rate:
        dto.firstReferralLevel1Rate ?? setting.firstReferralLevel1Rate,
      firstReferralLevel2Rate:
        dto.firstReferralLevel2Rate ?? setting.firstReferralLevel2Rate,
      firstReferralLevel3Rate:
        dto.firstReferralLevel3Rate ?? setting.firstReferralLevel3Rate,
      firstReferralLevel4Rate:
        dto.firstReferralLevel4Rate ?? setting.firstReferralLevel4Rate,
      firstReferralLevel5Rate:
        dto.firstReferralLevel5Rate ?? setting.firstReferralLevel5Rate,
      firstReferralLevel6Rate:
        dto.firstReferralLevel6Rate ?? setting.firstReferralLevel6Rate,
      firstReferralLevel1DirectRequired:
        dto.firstReferralLevel1DirectRequired ??
        setting.firstReferralLevel1DirectRequired,
      firstReferralLevel2DirectRequired:
        dto.firstReferralLevel2DirectRequired ??
        setting.firstReferralLevel2DirectRequired,
      firstReferralLevel3DirectRequired:
        dto.firstReferralLevel3DirectRequired ??
        setting.firstReferralLevel3DirectRequired,
      firstReferralLevel4DirectRequired:
        dto.firstReferralLevel4DirectRequired ??
        setting.firstReferralLevel4DirectRequired,
      firstReferralLevel5DirectRequired:
        dto.firstReferralLevel5DirectRequired ??
        setting.firstReferralLevel5DirectRequired,
      firstReferralLevel6DirectRequired:
        dto.firstReferralLevel6DirectRequired ??
        setting.firstReferralLevel6DirectRequired,
    };

    this.validateBotSettings(merged);

    Object.assign(setting, merged);
    const saved = await this.dataSource.getRepository(BotSetting).save(setting);
    return this.toBotSettingsResponse(saved);
  }

  private async loadLatestBotSetting(): Promise<BotSetting> {
    const existing = await this.dataSource
      .getRepository(BotSetting)
      .createQueryBuilder('setting')
      .orderBy('setting.created_at', 'DESC')
      .getOne();

    if (existing) {
      return existing;
    }

    const settingRepo = this.dataSource.getRepository(BotSetting);
    const created = settingRepo.create({
      minimumActivation: '10000',
      maximumActivation: '1000000',
      liquidityAllocationRate: '90',
      firstReferralRate: '10',
      firstReferralLevel1Rate: '6',
      firstReferralLevel2Rate: '1.5',
      firstReferralLevel3Rate: '1',
      firstReferralLevel4Rate: '0.6',
      firstReferralLevel5Rate: '0.5',
      firstReferralLevel6Rate: '0.4',
      firstReferralLevel1DirectRequired: 1,
      firstReferralLevel2DirectRequired: 2,
      firstReferralLevel3DirectRequired: 3,
      firstReferralLevel4DirectRequired: 4,
      firstReferralLevel5DirectRequired: 5,
      firstReferralLevel6DirectRequired: 6,
    });
    return settingRepo.save(created);
  }

  private validateBotSettings(input: {
    minimumActivation: string;
    maximumActivation: string;
    liquidityAllocationRate: string;
    firstReferralRate: string;
    firstReferralLevel1Rate: string;
    firstReferralLevel2Rate: string;
    firstReferralLevel3Rate: string;
    firstReferralLevel4Rate: string;
    firstReferralLevel5Rate: string;
    firstReferralLevel6Rate: string;
    firstReferralLevel1DirectRequired: number;
    firstReferralLevel2DirectRequired: number;
    firstReferralLevel3DirectRequired: number;
    firstReferralLevel4DirectRequired: number;
    firstReferralLevel5DirectRequired: number;
    firstReferralLevel6DirectRequired: number;
  }): void {
    const minimumActivation = this.toDecimal(input.minimumActivation);
    const maximumActivation = this.toDecimal(input.maximumActivation);
    const liquidityRate = this.toDecimal(input.liquidityAllocationRate);
    const referralRate = this.toDecimal(input.firstReferralRate);
    const levelRates = [
      this.toDecimal(input.firstReferralLevel1Rate),
      this.toDecimal(input.firstReferralLevel2Rate),
      this.toDecimal(input.firstReferralLevel3Rate),
      this.toDecimal(input.firstReferralLevel4Rate),
      this.toDecimal(input.firstReferralLevel5Rate),
      this.toDecimal(input.firstReferralLevel6Rate),
    ];

    if (!minimumActivation.gt(0)) {
      throw new BadRequestException('minimumActivation must be greater than zero');
    }

    if (maximumActivation.lt(minimumActivation)) {
      throw new BadRequestException(
        'maximumActivation must be >= minimumActivation',
      );
    }

    if (liquidityRate.lt(0)) {
      throw new BadRequestException('liquidityAllocationRate must be >= 0');
    }

    if (referralRate.lt(0)) {
      throw new BadRequestException('firstReferralRate must be >= 0');
    }

    if (!liquidityRate.plus(referralRate).eq(100)) {
      throw new BadRequestException(
        'liquidityAllocationRate + firstReferralRate must equal 100',
      );
    }

    const levelRateSum = levelRates.reduce(
      (sum, rate) => sum.plus(rate),
      new Decimal(0),
    );
    if (!levelRateSum.eq(referralRate)) {
      throw new BadRequestException(
        'L1-L6 first referral rates must total firstReferralRate',
      );
    }

    const directRequired = [
      input.firstReferralLevel1DirectRequired,
      input.firstReferralLevel2DirectRequired,
      input.firstReferralLevel3DirectRequired,
      input.firstReferralLevel4DirectRequired,
      input.firstReferralLevel5DirectRequired,
      input.firstReferralLevel6DirectRequired,
    ];

    if (directRequired[0] < 1) {
      throw new BadRequestException(
        'firstReferralLevel1DirectRequired must be >= 1',
      );
    }

    for (let i = 1; i < directRequired.length; i += 1) {
      if (directRequired[i] < directRequired[i - 1]) {
        throw new BadRequestException(
          `firstReferralLevel${i + 1}DirectRequired must be >= firstReferralLevel${i}DirectRequired`,
        );
      }
    }
  }

  private toDecimal(value: string | number | undefined | null): Decimal {
    try {
      return new Decimal(String(value ?? '0'));
    } catch {
      return new Decimal(0);
    }
  }

  private toBotSettingsResponse(setting: BotSetting): BotSettingsResponse {
    return {
      minimumActivation: setting.minimumActivation,
      maximumActivation: setting.maximumActivation,
      liquidityAllocationRate: setting.liquidityAllocationRate,
      firstReferralRate: setting.firstReferralRate,
      firstReferralLevel1Rate: setting.firstReferralLevel1Rate,
      firstReferralLevel2Rate: setting.firstReferralLevel2Rate,
      firstReferralLevel3Rate: setting.firstReferralLevel3Rate,
      firstReferralLevel4Rate: setting.firstReferralLevel4Rate,
      firstReferralLevel5Rate: setting.firstReferralLevel5Rate,
      firstReferralLevel6Rate: setting.firstReferralLevel6Rate,
      firstReferralLevel1DirectRequired:
        setting.firstReferralLevel1DirectRequired,
      firstReferralLevel2DirectRequired:
        setting.firstReferralLevel2DirectRequired,
      firstReferralLevel3DirectRequired:
        setting.firstReferralLevel3DirectRequired,
      firstReferralLevel4DirectRequired:
        setting.firstReferralLevel4DirectRequired,
      firstReferralLevel5DirectRequired:
        setting.firstReferralLevel5DirectRequired,
      firstReferralLevel6DirectRequired:
        setting.firstReferralLevel6DirectRequired,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  // ============================================================
  // REFERRAL HELPER METHODS
  // ============================================================

  private async resolveReferralAncestors(
    manager: EntityManager,
    userId: string,
  ): Promise<Array<{ id: string }>> {
    const userRepo = manager.getRepository(User);
    const ancestors: Array<{ id: string }> = [];
    const seenIds = new Set<string>([userId]);
    let currentUserId: string | null = userId;

    for (let level = 0; level < 6; level += 1) {
      const currentUser = await userRepo.findOne({
        where: { id: currentUserId },
        relations: { referrer: true },
      });

      if (!currentUser?.referredBy || !currentUser.referrer) {
        break;
      }

      const ancestorId = currentUser.referrer.id;

      // Guard against circular / duplicate referral chains
      if (seenIds.has(ancestorId)) {
        break;
      }
      seenIds.add(ancestorId);

      ancestors.push({ id: ancestorId });
      currentUserId = ancestorId;
    }

    return ancestors;
  }

  private async isReferralLevelEligible(
    manager: EntityManager,
    userId: string,
    level: number,
    setting: BotSetting,
  ): Promise<boolean> {
    const activeDirectCount = await this.countActiveDirectBots(manager, userId);
    const required = this.getDirectRequiredForLevel(setting, level);

    return activeDirectCount >= required;
  }

  private async countActiveDirectBots(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const botAccountRepo = manager.getRepository(BotAccount);

    return botAccountRepo
      .createQueryBuilder('bot')
      .innerJoin(
        User,
        'directUser',
        'directUser.id = bot.user_id AND directUser.referredBy = :recipientUserId',
      )
      .where('bot.status = :status', { status: BotAccountStatus.ACTIVE })
      .setParameter('recipientUserId', userId)
      .getCount();
  }

  private getDirectRequiredForLevel(
    setting: BotSetting,
    level: number,
  ): number {
    switch (level) {
      case 1:
        return setting.firstReferralLevel1DirectRequired ?? 1;
      case 2:
        return setting.firstReferralLevel2DirectRequired ?? 2;
      case 3:
        return setting.firstReferralLevel3DirectRequired ?? 3;
      case 4:
        return setting.firstReferralLevel4DirectRequired ?? 4;
      case 5:
        return setting.firstReferralLevel5DirectRequired ?? 5;
      case 6:
        return setting.firstReferralLevel6DirectRequired ?? 6;
      default:
        return 1;
    }
  }

  private async getOrCreateBalance(
    manager: EntityManager,
    userId: string,
  ): Promise<Balance> {
    const balanceRepo = manager.getRepository(Balance);
    let balance = await balanceRepo.findOne({ where: { userId } });
    if (!balance) {
      balance = balanceRepo.create({
        userId,
        availableBalance: '0.000000000000000000',
        lockedBalance: '0.000000000000000000',
        gameLocked: '0.000000000000000000',
        tradingLocked: '0.000000000000000000',
        withdrawalLocked: '0.000000000000000000',
        totalBalance: '0.000000000000000000',
      });
      balance = await balanceRepo.save(balance);
    }
    return balance;
  }

  private async saveReferralLedger(
    manager: EntityManager,
    input: {
      userId: string;
      amount: string;
      balanceBefore: string;
      balanceAfter: string;
      referenceId: string;
      level: number;
      activationId: string;
    },
  ): Promise<void> {
    const { userId, amount, balanceBefore, balanceAfter, referenceId, level, activationId } =
      input;
    const ledgerRepo = manager.getRepository(LedgerEntry);
    const entry = ledgerRepo.create({
      userId,
      type: LedgerType.BOT_FIRST_ACTIVATION_REFERRAL,
      amount,
      balanceBefore,
      balanceAfter,
      referenceId,
      referenceType: 'BOT_FIRST_ACTIVATION_REFERRAL',
      description: `Bot first activation referral L${level}`,
      metadata: { activationId, level, amount },
    });
    const saved = await ledgerRepo.save(entry);

    // Attribution: referral commission is NON-wagerable and never creates a
    // wagering obligation. Same transaction as the credit.
    await this.walletSourceService.recordCredit({
      manager,
      userId,
      sourceType: FUND_SOURCE_TYPE.REFERRAL_COMMISSION,
      sourceId: saved.id,
      ledgerEntryId: saved.id,
      amountTdx: amount,
      metadata: {
        referenceType: 'BOT_FIRST_ACTIVATION_REFERRAL',
        activationId,
        level,
        referenceId,
      },
    });
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async generateNextBotId(manager: EntityManager): Promise<string> {
    const result = await manager.query(`
      SELECT nextval('bot_id_seq') AS sequence
    `);

    const sequence = Number(result[0]?.sequence);

    if (!Number.isSafeInteger(sequence) || sequence < 1000) {
      throw new ConflictException('Unable to generate a valid Bot ID');
    }

    return `TDX${sequence}`;
  }

  private async loadBotAccount(
    manager: EntityManager,
    botAccountId: string,
  ): Promise<BotAccount> {
    const botAccount = await manager.getRepository(BotAccount).findOne({
      where: { id: botAccountId },
      relations: {
        botWallet: true,
      },
    });

    if (!botAccount) {
      throw new NotFoundException('Bot account not found');
    }

    return botAccount;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private normalizePage(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 1;
    return Math.max(1, Math.trunc(numericValue));
  }

  private normalizeLimit(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 10;
    return Math.min(100, Math.max(1, Math.trunc(numericValue)));
  }

  private resolveActivityTypes(filter: BotActivityFilter): BotWalletTransactionType[] {
    if (filter === BotActivityFilter.WALLET) {
      return [
        BotWalletTransactionType.TRANSFER_IN,
        BotWalletTransactionType.TRANSFER_OUT,
      ];
    }

    if (filter === BotActivityFilter.STATUS) {
      return [
        BotWalletTransactionType.BOT_ACTIVATION,
        BotWalletTransactionType.BOT_DEACTIVATION,
      ];
    }

    if (filter === BotActivityFilter.TRADE) {
      return [
        BotWalletTransactionType.PROFIT_CREDIT,
        BotWalletTransactionType.LOSS_DEBIT,
        BotWalletTransactionType.SETTLEMENT,
      ];
    }

    return [];
  }

  // ✅ FIXED: Null safety for createdAt
  private mapTransactionToActivity(transaction: BotWalletTransaction): BotActivityItem {
    const activityMapping = this.getActivityMapping(transaction.type);
    const normalizedAmount = this.toFixed18(transaction.amount);
    const signedAmount =
      activityMapping.direction === 'DEBIT'
        ? `-${normalizedAmount}`
        : activityMapping.direction === 'CREDIT'
          ? `+${normalizedAmount}`
          : normalizedAmount;

    return {
      id: transaction.id,
      type: transaction.type,
      category: activityMapping.category,
      title: activityMapping.title,
      description: transaction.description || activityMapping.defaultDescription,
      amount: normalizedAmount,
      signedAmount,
      direction: activityMapping.direction,
      status: transaction.status,
      referenceType: transaction.referenceType ?? null,
      referenceId: transaction.referenceId ?? null,
      // ✅ NULL SAFETY: If createdAt is null/undefined, use current date
      createdAt: transaction.createdAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  private getActivityMapping(type: BotWalletTransactionType): {
    category: BotActivityCategory;
    title: string;
    defaultDescription: string;
    direction: BotActivityDirection;
  } {
    if (type === BotWalletTransactionType.TRANSFER_IN) {
      return {
        category: 'WALLET',
        title: 'Transfer In',
        defaultDescription: 'Transfer from Main Wallet to Bot Wallet',
        direction: 'CREDIT',
      };
    }

    if (type === BotWalletTransactionType.TRANSFER_OUT) {
      return {
        category: 'WALLET',
        title: 'Transfer Out',
        defaultDescription: 'Transfer from Bot Wallet to Main Wallet',
        direction: 'DEBIT',
      };
    }

    if (type === BotWalletTransactionType.BOT_ACTIVATION) {
      return {
        category: 'STATUS',
        title: 'Bot Activation',
        defaultDescription: 'Bot activation consumed balance from Bot Wallet',
        direction: 'DEBIT',
      };
    }

    if (type === BotWalletTransactionType.BOT_DEACTIVATION) {
      return {
        category: 'STATUS',
        title: 'Bot Deactivation',
        defaultDescription: 'Bot deactivation returned balance to Bot Wallet',
        direction: 'CREDIT',
      };
    }

    if (type === BotWalletTransactionType.PROFIT_CREDIT) {
      return {
        category: 'TRADE',
        title: 'Profit Credit',
        defaultDescription: 'Trading profit credited to Bot Wallet',
        direction: 'CREDIT',
      };
    }

    if (type === BotWalletTransactionType.LOSS_DEBIT) {
      return {
        category: 'TRADE',
        title: 'Loss Debit',
        defaultDescription: 'Trading loss debited from Bot Wallet',
        direction: 'DEBIT',
      };
    }

    return {
      category: 'TRADE',
      title: 'Settlement',
      defaultDescription: 'Monthly settlement posted to Bot Wallet',
      direction: 'CREDIT',
    };
  }

  private toFixed18(value: string | number | null | undefined): string {
    try {
      return new Decimal(String(value ?? '0')).toFixed(18);
    } catch {
      return '0.000000000000000000';
    }
  }
}