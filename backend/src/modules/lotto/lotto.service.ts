// backend/src/modules/lotto/lotto.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  QueryRunner,
  In,
  LessThanOrEqual,
  MoreThan,
  EntityManager,
  FindOptionsWhere,
} from 'typeorm';
import { randomUUID, randomInt } from 'crypto';
import Decimal from 'decimal.js';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { AdminSetting } from '../../admin/entities/admin-setting.entity';
import { LottoRound } from './entities/lotto-round.entity';
import { LottoTicket } from './entities/lotto-ticket.entity';
import { LottoResult, ResultSource, ResultStatus } from './entities/lotto-result.entity';
import {
  LottoSettlement,
  SettlementOutcome,
  SettlementStatus,
} from './entities/lotto-settlement.entity';
import {
  ReferralBonus,
  ReferralStatus,
} from './entities/referral-bonus.entity';
import { AdminPool } from './entities/admin-pool.entity';
import {
  AdminPoolTransaction,
  AdminPoolTxType,
} from './entities/admin-pool-transaction.entity';
import { Category, RoundStatus } from './entities/lotto-round.entity';
import {
  ReservationStatus,
  TicketStatus,
} from './entities/lotto-ticket.entity';
import { User } from '../../users/user.entity';
import { LedgerEntry, LedgerType } from '../../ledger/ledger.entity';
import { Balance } from '../../balances/balance.entity';
import { PeriodSyncService } from '../period-sync/period-sync.service';
import { formatWingoPeriodNumber } from '../period-sync/wingo-period-number';
import {
  LOTTO_WIN_STRATEGY_SETTING_KEY,
  LottoWinStrategyService,
} from './services/lotto-win-strategy.service';
import {
  WIN_STRATEGY_VALUES,
  WinStrategy,
  isWinStrategy,
  normalizeWinStrategy,
} from './utils/lotto-win-strategy.util';

const ACTIVE_ROUND_SETTLEMENT_STATUSES: RoundStatus[] = [RoundStatus.RESULTED];

const TERMINAL_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.SETTLED,
  RoundStatus.CANCELLED,
  RoundStatus.REFUNDED,
  RoundStatus.FAILED,
];

const TERMINAL_NON_SETTLABLE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.CANCELLED,
  RoundStatus.REFUNDED,
  RoundStatus.FAILED,
];

const TERMINAL_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.SETTLED,
  TicketStatus.REFUNDED,
  TicketStatus.CANCELLED,
];

const VALID_RESULT_VALUES = new Set([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
]);

const VALID_RESULT_VALUES_ARRAY = Array.from(VALID_RESULT_VALUES);

const LOTTO_PAUSED_SETTING_KEY = 'LOTTO_PAUSED';
const LOTTO_RESULT_MODE_SETTING_KEY = 'LOTTO_RESULT_MODE';
const PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY = 'PULSE_LIQUIDITY_POOL_BALANCE';

const SUPPORTED_LOTTO_RESULT_MODES = new Set([
  'SERVER_RANDOM',
  'ADMIN_RESULT',
  'VERIFIED_RANDOM',
]);

const ALL_LOTTO_CATEGORIES: Category[] = [
  Category.THIRTY_SEC,
  Category.ONE_MIN,
  Category.THREE_MIN,
  Category.FIVE_MIN,
];

const CATEGORY_DURATION_SECONDS: Record<Category, number> = {
  [Category.THIRTY_SEC]: 30,
  [Category.ONE_MIN]: 60,
  [Category.THREE_MIN]: 180,
  [Category.FIVE_MIN]: 300,
};

// The result is PRE-COMPUTED at the cutoff and revealed at drawAt, so clients
// may cache it during exactly this window ([cutoffAt, drawAt]) — see
// getPendingResult(). That is what makes the 00:00 reveal instantaneous: the
// value is already in the browser, so no API round-trip happens at 0.
const RESULT_PRE_REVEAL_SECONDS = 5;

// Betting closes this many seconds before the draw. ONE shared cutoff boundary
// for the backend (ticket rejection + result pre-computation) and the frontend
// (Buy Card close), so the countdown and the reveal can never disagree about
// when the round stopped accepting tickets. Kept equal to the pre-reveal window
// because "betting closed" is exactly the condition that makes an early value
// unexploitable.
const LOTTO_TICKET_CUTOFF_SECONDS = RESULT_PRE_REVEAL_SECONDS;

// In ADMIN_RESULT mode the engine waits this many extra periods for an admin to
// set/lock the result before falling back to a server draw. One extra period is
// enough for a live decision yet guarantees a round can never be stuck in
// DRAWING forever (which would leave tickets reserved and unsettleable).
const ADMIN_RESULT_FALLBACK_GRACE_PERIODS = 1;

const INITIAL_PERIOD_NUMBER = 6;

interface AdminActionContext {
  adminId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface AdminAuditEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AdminCategoryCard {
  category: Category;
  round: {
    id: number;
    roundNumber: string;
    status: RoundStatus;
    startAt: string | null;
    cutoffAt: string | null;
    drawAt: string | null;
    remainingSeconds: number;
    result: string | null;
    resultSource: string | null;
    resultGeneratedAt: string | null;
    // Admin result locked in advance (source=ADMIN, not finalized yet).
    lockedResult: string | null;
    lockedResultSource: string | null;
    lockedAt: string | null;
    settledAt: string | null;
  } | null;
  tickets: number;
  volume: number;
  reservedExposure: number;
}

export interface AdminRoundSummary {
  id: number;
  roundNumber: string;
  category: Category;
  status: RoundStatus;
  startAt: string | null;
  cutoffAt: string | null;
  drawAt: string | null;
  result: string | null;
  resultSource: string | null;
  resultGeneratedAt: string | null;
  // Admin result locked in advance (source=ADMIN, not finalized yet).
  lockedResult: string | null;
  lockedResultSource: string | null;
  lockedAt: string | null;
  settledAt: string | null;
  refundedAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  totalTickets: number;
  totalAmount: number;
  reservedExposure: number;
  remainingSeconds: number;
}

interface TicketListQuery {
  limit?: number;
  offset?: number;
  roundId?: number;
  status?: TicketStatus;
  category?: Category;
}

export interface LottoRuntimeControls {
  paused: boolean;
  resultMode: string;
  winStrategy: WinStrategy;
}

interface RoundSettlementResult {
  roundId: number;
  status: RoundStatus;
  result: string | null;
  settledAt: string | null;
}

@Injectable()
export class LottoService {
  private readonly logger = new Logger(LottoService.name);

  constructor(
    @InjectRepository(LottoRound)
    private roundRepo: Repository<LottoRound>,
    @InjectRepository(LottoTicket)
    private ticketRepo: Repository<LottoTicket>,
    @InjectRepository(LottoResult)
    private resultRepo: Repository<LottoResult>,
    @InjectRepository(LottoSettlement)
    private settlementRepo: Repository<LottoSettlement>,
    @InjectRepository(ReferralBonus)
    private referralBonusRepo: Repository<ReferralBonus>,
    @InjectRepository(AdminPool)
    private adminPoolRepo: Repository<AdminPool>,
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepo: Repository<AdminSetting>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(AdminAuditLog)
    private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
    private readonly periodSyncService: PeriodSyncService,
    private readonly winStrategyService: LottoWinStrategyService,
    private dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getActiveRound(category?: Category) {
    const controls = await this.getLottoRuntimeControls();

    // NOTE: `winStrategy` is deliberately NOT part of the public payload — it is
    // an internal draw-engine control and must never be exposed to players.
    const publicControls = {
      paused: controls.paused,
      resultMode: controls.resultMode,
    };

    const where: FindOptionsWhere<LottoRound> = {
      status: RoundStatus.OPEN,
    };

    if (category) {
      where.category = category;
    }

    const round = await this.roundRepo.findOne({
      where,
      order: {
        drawAt: 'ASC',
        createdAt: 'ASC',
      },
      relations: {
        result: true,
      },
    });

    return {
      controls: publicControls,
      round: round ? this.toRoundView(round) : null,
      // Synchronized server time so the frontend can compute an offset and
      // remain correct even if the user's local clock is wrong (req 9, 10).
      serverNow: new Date().toISOString(),
      // Authoritative WinGo period state for the SELECTED category (THIRTY_SEC →
      // WinGo_30S, ONE_MIN → WinGo_1M, THREE_MIN → WinGo_3M, FIVE_MIN →
      // WinGo_5M). Falls back to the 30-second snapshot when no category is
      // supplied so the legacy contract is unchanged.
      wingoPeriod: category
        ? this.periodSyncService.getSnapshotForCategory(category)
        : this.periodSyncService.getSnapshot(),
    };
  }

  // ============================================================
  // ROUND ENGINE — server-side round creation / lifecycle / draw
  // ============================================================

  /**
   * Single tick invoked periodically by the round-engine worker.
   *  - Ensures every supported category has an OPEN round.
   *  - Advances OPEN → CUTOFF → DRAWING according to persisted timestamps.
   *  - Generates and finalizes the server result for due rounds unless the
   *    active result mode is ADMIN_RESULT (waits for an admin).
   */
  async tickRoundEngine(): Promise<{ created: number; resulted: number }> {
    let created = 0;
    let resulted = 0;

    for (const category of ALL_LOTTO_CATEGORIES) {
      if (await this.ensureActiveRoundForCategory(category)) {
        created += 1;
      }
    }

    resulted += await this.advanceRoundLifecycle();

    return { created, resulted };
  }

  /**
   * Creates the next OPEN round for a category when none exists.
   *
   * Authoritative round creation for a reference-backed category (30S / 1M /
   * 3M / 5M). Uses the synced periodNumber + startTime/endTime for THAT
   * category. If the reference says a period other than our current OPEN round,
   * we reconcile. Never fabricates a period.
   *
   * Every supported category is reference-backed, so the legacy independent
   * generator (ensureGeneratedRound) is no longer reachable from the round
   * engine's category loop.
   */
  private async ensureActiveRoundForCategory(
    category: Category,
  ): Promise<boolean> {
    // Any category backed by an authoritative external reference (THIRTY_SEC,
    // ONE_MIN, THREE_MIN, FIVE_MIN) uses the EXACT SAME synced-round path: the
    // period number + start/end boundary always come from the reference, never
    // from a locally generated sequence.
    if (this.periodSyncService.hasReferenceForCategory(category)) {
      return this.ensureSyncedRound(category);
    }
    return this.ensureGeneratedRound(category);
  }

  /**
   * Authoritative round creation for a reference-backed category (30S / 1M /
   * 3M / 5M). Uses the synced periodNumber + startTime/endTime for THAT
   * category. If the reference says a period other than our current OPEN round,
   * we reconcile. Never fabricates a period.
   */
  private async ensureSyncedRound(category: Category): Promise<boolean> {
    const snapshot = this.periodSyncService.getSnapshotForCategory(category);

    // No authoritative data yet — never fabricate a period.
    if (!snapshot) {
      return false;
    }

    // Invariant: the reference period number must be reproducible from its own
    // END boundary for THIS category. A mismatch means the category→game
    // mapping or the encoding drifted, so the number would be foreign to the
    // category (exactly how the legacy cross-category rows happened). Warn
    // loudly instead of silently persisting a wrong period number.
    const derivedPeriodNumber = formatWingoPeriodNumber(
      category,
      snapshot.endTime,
    );
    if (
      derivedPeriodNumber &&
      derivedPeriodNumber !== snapshot.periodNumber
    ) {
      this.logger.warn(
        `[Lotto:${category}] reference period ${snapshot.periodNumber} does not match its own encoding ${derivedPeriodNumber} (endTime=${snapshot.endTime}).`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existing = await queryRunner.manager
        .createQueryBuilder(LottoRound, 'round')
        .setLock('pessimistic_write')
        .where('round.category = :category AND round.status = :status', {
          category,
          status: RoundStatus.OPEN,
        })
        .orderBy('round.id', 'DESC')
        .getOne();

      if (existing && existing.roundNumber === snapshot.periodNumber) {
        // Already synchronized to the authoritative current period.
        await queryRunner.commitTransaction();
        return false;
      }

      // Recovery path: a row for the authoritative current period may already
      // exist in a non-OPEN state (e.g. closed by a lifecycle pass that ran
      // against a briefly stale/behind reference payload). While the reference
      // still reports this period as live (now < endTime), restore it to OPEN
      // with the authoritative timestamps instead of attempting a duplicate
      // INSERT. Never fabricate — the period always comes from the reference.
      const samePeriodRow = await queryRunner.manager
        .createQueryBuilder(LottoRound, 'round')
        .setLock('pessimistic_write')
        .where('round.category = :category AND round.roundNumber = :roundNumber', {
          category,
          roundNumber: snapshot.periodNumber,
        })
        .getOne();

      const nowMs = Date.now();
      if (samePeriodRow && nowMs < snapshot.endTime) {
        samePeriodRow.status = RoundStatus.OPEN;
        samePeriodRow.startAt = new Date(snapshot.startTime);
        samePeriodRow.drawAt = new Date(snapshot.endTime);
        samePeriodRow.cutoffAt = new Date(
          snapshot.endTime - LOTTO_TICKET_CUTOFF_SECONDS * 1000,
        );
        await queryRunner.manager.save(samePeriodRow);
        await queryRunner.commitTransaction();
        return true;
      }

      // The reference has already moved past this period — do not insert.
      if (samePeriodRow) {
        await queryRunner.commitTransaction();
        return false;
      }

      // If there is an OPEN round for a DIFFERENT (stale) period, close it so
      // the new authoritative period can become active. The lifecycle advance
      // will finalize it on the next tick.
      if (existing) {
        existing.status = RoundStatus.DRAWING;
        await queryRunner.manager.save(existing);
      }

      const startAt = new Date(snapshot.startTime);
      const drawAt = new Date(snapshot.endTime);
      const cutoffAt = new Date(
        drawAt.getTime() - LOTTO_TICKET_CUTOFF_SECONDS * 1000,
      );

      const round = queryRunner.manager.create(LottoRound, {
        roundNumber: snapshot.periodNumber,
        category,
        status: RoundStatus.OPEN,
        startAt,
        cutoffAt,
        drawAt,
      });

      await queryRunner.manager.save(round);
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (this.isRoundNumberUniqueViolation(error)) {
        return false;
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Legacy independent round generation for non-THIRTY_SEC categories.
   * Period numbers are sequential per category and start at 000006.
   */
  private async ensureGeneratedRound(category: Category): Promise<boolean> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existing = await queryRunner.manager
        .createQueryBuilder(LottoRound, 'round')
        .setLock('pessimistic_write')
        .where('round.category = :category AND round.status = :status', {
          category,
          status: RoundStatus.OPEN,
        })
        .orderBy('round.id', 'DESC')
        .getOne();

      if (existing) {
        await queryRunner.commitTransaction();
        return false;
      }

      const periodNumber = await this.computeNextPeriodNumber(
        queryRunner.manager,
        category,
      );
      const startAt = new Date();
      const durationSeconds =
        CATEGORY_DURATION_SECONDS[category] ?? 30;
      const drawAt = new Date(startAt.getTime() + durationSeconds * 1000);
      const cutoffAt = new Date(
        drawAt.getTime() - LOTTO_TICKET_CUTOFF_SECONDS * 1000,
      );

      const round = queryRunner.manager.create(LottoRound, {
        roundNumber: periodNumber,
        category,
        status: RoundStatus.OPEN,
        startAt,
        cutoffAt,
        drawAt,
      });

      await queryRunner.manager.save(round);
      await queryRunner.commitTransaction();
      return true;
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (this.isRoundNumberUniqueViolation(error)) {
        return false;
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async computeNextPeriodNumber(
    manager: EntityManager,
    category: Category,
  ): Promise<string> {
    const rows = await manager
      .getRepository(LottoRound)
      .createQueryBuilder('round')
      .select('round.roundNumber', 'roundNumber')
      .where('round.category = :category', { category })
      .getRawMany();

    let maxPeriod = INITIAL_PERIOD_NUMBER - 1;

    for (const row of rows) {
      const raw = String(row?.roundNumber ?? '').trim();

      // Only canonical all-digit period numbers participate in the frozen
      // per-category sequence (which starts at 000006). Legacy/foreign round
      // identifiers are ignored so they can never corrupt the sequence.
      if (!/^\d+$/.test(raw)) {
        continue;
      }

      const parsed = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(parsed) || parsed <= maxPeriod) {
        continue;
      }

      maxPeriod = parsed;
    }

    return String(maxPeriod + 1).padStart(6, '0');
  }

  /**
   * Advances OPEN → CUTOFF → DRAWING from persisted timestamps and then
   * finalizes SERVER results for due rounds (unless ADMIN_RESULT mode).
   */
  private async advanceRoundLifecycle(): Promise<number> {
    const now = new Date();

    await this.roundRepo
      .createQueryBuilder()
      .update(LottoRound)
      .set({ status: RoundStatus.CUTOFF })
      .where('status = :openStatus AND cutoffAt <= :now', {
        openStatus: RoundStatus.OPEN,
        now,
      })
      .execute();

    await this.roundRepo
      .createQueryBuilder()
      .update(LottoRound)
      .set({ status: RoundStatus.DRAWING })
      .where('status = :cutoffStatus AND drawAt <= :now', {
        cutoffStatus: RoundStatus.CUTOFF,
        now,
      })
      .execute();

    const controls = await this.getLottoRuntimeControls();

    // ------------------------------------------------------------------
    // PRE-COMPUTATION PASS (runs BEFORE the draw pass below).
    //
    // As soon as a round reaches its cutoff — i.e. the last
    // RESULT_PRE_REVEAL_SECONDS of the period, when tickets are already
    // rejected — the result value is drawn and stored once
    // (status=GENERATED). Nothing at drawAt can then change it, and the
    // public endpoints publish it the moment server time crosses drawAt
    // (see getRecentResults / getPendingResult) instead of waiting for the
    // next engine tick. That is what removes the previous 2-3s delay.
    // ------------------------------------------------------------------
    const precomputableRounds = await this.roundRepo.find({
      where: {
        status: In([RoundStatus.CUTOFF, RoundStatus.DRAWING]),
        cutoffAt: LessThanOrEqual(now),
        drawAt: MoreThan(now),
      },
      take: 50,
      order: { drawAt: 'ASC', id: 'ASC' },
    });

    for (const round of precomputableRounds) {
      if (round.resultId) {
        continue;
      }

      await this.precomputeResultForRound(round.id);
    }

    const dueRounds = await this.roundRepo.find({
      where: {
        status: In([
          RoundStatus.DRAWING,
          RoundStatus.CUTOFF,
          RoundStatus.RESULTED,
        ]),
        drawAt: LessThanOrEqual(now),
      },
      take: 50,
      order: { drawAt: 'ASC', id: 'ASC' },
    });

    let resulted = 0;

    for (const round of dueRounds) {
      if (round.resultId) {
        continue;
      }

      // 1. An admin pre-locked result is honoured EXACTLY as locked: the admin
      //    may lock a symbol while the period is still open (source=ADMIN,
      //    status=GENERATED) and the engine promotes it to the final result at
      //    draw time. No racing, no override, no second draw.
      const lockedResult = await this.findLockedAdminResult(round.id);

      if (lockedResult && lockedResult.adminId) {
        const outcome = await this.finalizeRoundResult(
          round.id,
          lockedResult.result,
          'ADMIN',
          lockedResult.adminId,
          { reason: 'Pre-locked admin result applied at draw time' },
        );

        if (outcome.finalized) {
          resulted += 1;
        }
        continue;
      }

      // 2. ADMIN_RESULT mode: wait one extra period for the admin before the
      //    engine falls back to a server draw, so a round can never be stuck in
      //    DRAWING (which would leave every ticket reserved and unsettleable).
      if (
        controls.resultMode === 'ADMIN_RESULT' &&
        now.getTime() <
          round.drawAt.getTime() + this.resolveAdminResultGraceMs(round.category)
      ) {
        continue;
      }

      const outcome = await this.finalizeRoundResult(
        round.id,
        null,
        'SERVER',
        null,
      );

      if (outcome.finalized) {
        resulted += 1;
      }
    }

    return resulted;
  }

  /**
   * ATOMIC CUTOFF TRANSITION — closes betting and generates the result.
   *
   * This is the ONLY place where a final result row may be created for a
   * round, and it runs strictly AFTER the betting cutoff:
   *
   *   1. Lock the round row (pessimistic_write) — serializes concurrent
   *      engine ticks / on-demand callers so exactly one of them proceeds.
   *   2. Re-read server time INSIDE the transaction.
   *   3. HARD GUARD: if now < cutoffAt → betting still open → return null
   *      without touching anything (no close, no draw, no persist).
   *   4. Otherwise flip OPEN → CUTOFF first (betting closed from this instant;
   *      purchaseTicket requires OPEN so no new bet can slip in afterwards).
   *   5. Only then draw + persist the GENERATED result row (idempotent —
   *      an existing row is returned as-is; unique index is the backstop).
   *
   * A request arriving before the cutoff can therefore never trigger result
   * generation, and two concurrent workers can never produce two results:
   * the loser either sees the cutoff guard fail (too early) or finds the
   * winner's row (idempotent replay).
   */
  private async precomputeResultForRound(roundId: number): Promise<{
    id: number;
    result: string;
    source: ResultSource;
    generatedAt: Date | null;
  } | null> {
    return this.dataSource.transaction(async (manager) => {
      const txRoundRepo = manager.getRepository(LottoRound);
      const txResultRepo = manager.getRepository(LottoResult);

      const round = await txRoundRepo.findOne({
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!round) {
        return null;
      }

      // Already finalized → published through the normal (finalize) path.
      if (round.resultId) {
        return null;
      }

      // HARD CUTOFF GUARD — re-checked with server time INSIDE the
      // transaction, AFTER acquiring the round row lock. If betting is still
      // open (now < cutoffAt) this call must not close betting, draw, lock,
      // or persist anything: the round stays in its normal betting state and
      // the caller gets null (rejected/skipped, never a result).
      if (round.cutoffAt.getTime() > Date.now()) {
        return null;
      }

      // ATOMIC BETTING CLOSE — flip OPEN → CUTOFF *before* any draw, in the
      // same transaction. purchaseTicket() accepts only OPEN rounds, so from
      // this instant no new bet can be accepted for this round; the result
      // drawn below therefore always sees the final, complete ticket set.
      // CUTOFF/DRAWING rounds are already closed — fall through to the draw.
      // Terminal non-settlable rounds can never be drawn.
      if (round.status === RoundStatus.OPEN) {
        round.status = RoundStatus.CUTOFF;
        await txRoundRepo.save(round);
      }

      if (this.isTerminalNonSettlableRoundStatus(round.status)) {
        return null;
      }

      const existing = await txResultRepo.findOne({
        where: { roundId: round.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (existing && existing.status === ResultStatus.FINALIZED) {
        return null;
      }

      if (existing) {
        const preparedValue = this.normalizeResultValue(existing.result);

        if (preparedValue && VALID_RESULT_VALUES.has(preparedValue)) {
          return {
            id: existing.id,
            result: preparedValue,
            source: existing.source,
            generatedAt: existing.generatedAt ?? null,
          };
        }
        // Foreign/invalid leftover row — replace it with a proper server draw.
      }

      const value = await this.generateServerResult(manager, round.id);

      const row = existing ?? txResultRepo.create({ roundId: round.id });
      row.result = value;
      row.source = ResultSource.SERVER;
      row.adminId = null;
      row.status = ResultStatus.GENERATED;
      // Publication instant — the prepared value becomes official here.
      row.finalizedAt = round.drawAt;

      const saved = await txResultRepo.save(row);

      return {
        id: saved.id,
        result: value,
        source: saved.source,
        generatedAt: saved.generatedAt ?? null,
      };
    });
  }

  /**
   * Pending-round metadata for the cutoff window — NEVER discloses the result.
   *
   * Before the official reveal (server time < drawAt) this endpoint returns
   * only safe metadata (round id/number, status, cutoffAt, drawAt/revealAt,
   * serverNow). The actual result value is NEVER included, for ANY source
   * (SERVER or ADMIN), and this method NEVER triggers result generation:
   * generation happens exclusively in the engine's cutoff transition
   * (precomputeResultForRound), never from a read path.
   *
   * After the reveal the value is served by getRecentResults /
   * getResultByRoundId (both gated on server time crossing drawAt).
   */
  async getPendingResult(category?: Category) {
    const now = new Date();

    const where: FindOptionsWhere<LottoRound> = {
      cutoffAt: LessThanOrEqual(now),
      drawAt: MoreThan(now),
      status: In([RoundStatus.OPEN, RoundStatus.CUTOFF, RoundStatus.DRAWING]),
    };

    if (category) {
      where.category = category;
    }

    const round = await this.roundRepo.findOne({
      where,
      order: { drawAt: 'ASC', id: 'ASC' },
    });

    if (!round) {
      return {
        serverNow: new Date().toISOString(),
        pendingResult: null,
      };
    }

    const prepared = await this.precomputeResultForRound(round.id);

    // The result value is NEVER disclosed before the official reveal, for any
    // source. `prepared` existing only tells us the cutoff transition ran
    // (betting safely closed); the value itself stays server-side until
    // drawAt. Clients flip to the value via the post-draw result endpoints.
    if (!prepared) {
      return {
        serverNow: new Date().toISOString(),
        pendingResult: null,
      };
    }

    return {
      // Authoritative server time (ISO) — the client keeps its clock offset in
      // sync with this on every call, so the countdown and the 00:00 reveal are
      // driven by server time only.
      serverNow: new Date().toISOString(),
      pendingResult: {
        roundId: round.id,
        roundNumber: round.roundNumber,
        category: round.category,
        status: round.status,
        cutoffAt: round.cutoffAt.toISOString(),
        // Earliest instant the value may be shown to the player.
        revealAt: round.drawAt.toISOString(),
        drawAt: round.drawAt.toISOString(),
      },
    };
  }

  /** Extra time (ms) the engine waits for an admin result before auto-drawing. */
  private resolveAdminResultGraceMs(category: Category): number {
    return (
      CATEGORY_DURATION_SECONDS[category] *
      ADMIN_RESULT_FALLBACK_GRACE_PERIODS *
      1000
    );
  }

  /**
   * Returns the admin-locked (not yet finalized) result of a round, if any.
   * A locked row is a lotto_results row with status=GENERATED, source=ADMIN.
   */
  private async findLockedAdminResult(
    roundId: number,
    manager?: EntityManager,
  ): Promise<{
    id: number;
    result: string;
    adminId: string | null;
    generatedAt: Date | null;
  } | null> {
    const resultRepo = manager
      ? manager.getRepository(LottoResult)
      : this.resultRepo;

    const locked = await resultRepo.findOne({
      where: {
        roundId,
        status: ResultStatus.GENERATED,
        source: ResultSource.ADMIN,
      },
      select: { id: true, result: true, adminId: true, generatedAt: true },
    });

    if (!locked) {
      return null;
    }

    const normalized = this.normalizeResultValue(locked.result);
    if (!normalized || !VALID_RESULT_VALUES.has(normalized)) {
      return null;
    }

    return {
      id: locked.id,
      result: normalized,
      adminId: locked.adminId ?? null,
      generatedAt: locked.generatedAt ?? null,
    };
  }

  private isRoundNumberUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const driverError =
      'driverError' in error
        ? (error as { driverError?: { code?: string } }).driverError
        : undefined;

    // Any unique violation while inserting a new round means another ticker
    // created the same (category, periodNumber) concurrently — safe no-op.
    return driverError?.code === '23505';
  }

  /**
   * Finalizes exactly one result per round (atomic, pessimistic lock).
   * Used by the server draw engine (source=SERVER) and by authorized admins
   * (source=ADMIN). A round can never receive a second final result.
   */
  async finalizeRoundResult(
    roundId: number,
    result: string | null,
    source: 'SERVER' | 'ADMIN',
    adminId?: string | null,
    context: {
      ipAddress?: string | null;
      userAgent?: string | null;
      reason?: string | null;
    } = {},
  ): Promise<{ finalized: boolean; result: string | null }> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const txRoundRepo = manager.getRepository(LottoRound);
      const txResultRepo = manager.getRepository(LottoResult);

      const round = await txRoundRepo.findOne({
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!round) {
        throw new NotFoundException('ROUND_NOT_FOUND');
      }

      // Already finalized — idempotent: return the existing result.
      if (round.resultId) {
        const existing = await txResultRepo.findOne({
          where: { id: round.resultId },
        });
        return {
          finalized: false,
          result: this.normalizeResultValue(existing?.result),
        };
      }

      const existingResult = await txResultRepo.findOne({
        where: { roundId: round.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        existingResult &&
        existingResult.status === ResultStatus.FINALIZED
      ) {
        round.resultId = existingResult.id;
        round.resultGeneratedAt = existingResult.finalizedAt;
        round.status = RoundStatus.RESULTED;
        await txRoundRepo.save(round);
        return {
          finalized: false,
          result: this.normalizeResultValue(existingResult.result),
        };
      }

      // Lifecycle guard: never draw a round that is already terminal, and
      // never draw before the draw time.
      if (this.isTerminalNonSettlableRoundStatus(round.status)) {
        throw new ConflictException('ROUND_NOT_DRAWABLE');
      }

      if (round.drawAt.getTime() > new Date().getTime()) {
        throw new ConflictException('ROUND_NOT_DRAWN');
      }

      if (source === 'ADMIN' && !adminId) {
        throw new BadRequestException('ADMIN_ID_REQUIRED');
      }

      // A prepared value for this round is PROMOTED VERBATIM — never re-drawn.
      //
      // Two kinds of prepared rows exist:
      //   - admin pre-lock  (GENERATED + ADMIN) — as before;
      //   - server pre-computation at cutoff (GENERATED + SERVER).
      // The server draw below would produce a DIFFERENT symbol, which would
      // break the value the client has already cached for the 00:00 reveal.
      const preparedValue =
        existingResult?.status === ResultStatus.GENERATED
          ? this.normalizeResultValue(existingResult.result)
          : null;

      const hasPreparedValue = Boolean(
        preparedValue && VALID_RESULT_VALUES.has(preparedValue),
      );

      const effectiveSource: 'SERVER' | 'ADMIN' =
        source === 'ADMIN' || existingResult?.source === ResultSource.ADMIN
          ? 'ADMIN'
          : 'SERVER';

      let normalizedResultValue: string;

      if (source === 'ADMIN') {
        // An explicit admin draw always wins (resultMode/ADMIN_RESULT paths).
        normalizedResultValue = this.normalizeManualResult(result);
      } else if (hasPreparedValue) {
        // Promote the pre-computed (or admin-locked) value unchanged.
        normalizedResultValue = preparedValue as string;
      } else {
        normalizedResultValue = await this.generateServerResult(
          manager,
          round.id,
        );
      }

      const resultRow =
        existingResult ??
        txResultRepo.create({
          roundId: round.id,
        });

      resultRow.result = normalizedResultValue;
      resultRow.source = effectiveSource as ResultSource;
      resultRow.adminId =
        effectiveSource === 'ADMIN'
          ? (source === 'ADMIN' ? (adminId ?? null) : (existingResult?.adminId ?? null))
          : null;
      resultRow.status = ResultStatus.FINALIZED;
      resultRow.finalizedAt = new Date();

      await txResultRepo.save(resultRow);

      round.resultId = resultRow.id;
      round.resultGeneratedAt = resultRow.finalizedAt;
      round.status = RoundStatus.RESULTED;
      round.errorMessage = null;
      await txRoundRepo.save(round);

      return {
        finalized: true,
        result: normalizedResultValue,
      };
    });

    if (source === 'ADMIN' && adminId && outcome.finalized) {
      await this.writeAuditLog({
        adminId,
        action: 'MANUAL_RESULT',
        targetType: 'lotto_round',
        targetId: roundId,
        oldValue: { resultSource: null },
        newValue: {
          result: outcome.result,
          resultSource: 'ADMIN',
          status: RoundStatus.RESULTED,
          finalizedAt: new Date().toISOString(),
        },
        metadata: {
          roundId,
          result: outcome.result,
          resultSource: 'ADMIN',
          reason: context.reason?.trim() || undefined,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    return outcome;
  }

  /**
   * Admin result entry point with exact, race-free semantics.
   *
   * Timing rule (cutoff-first): no final-result write — lock or finalize —
   * may land while betting is still open (now < cutoffAt). After the cutoff
   * (betting closed) the symbol is LOCKED (lotto_results row with
   * status=GENERATED, source=ADMIN) and the draw engine applies it verbatim
   * at draw time — an admin decision can never be overwritten by the server
   * draw.
   *
   * - Round already finalized → idempotent no-op (existing result returned).
   * - Cutoff reached, not yet drawn → LOCK until draw time.
   * - Round already drawn     → finalized immediately (source=ADMIN).
   * - Before cutoff           → rejected (RESULT_LOCK_BEFORE_CUTOFF).
   */
  async setAdminResult(
    roundId: number,
    result: string,
    adminId: string,
    context: AdminActionContext,
    reason?: string,
  ): Promise<{
    finalized: boolean;
    locked: boolean;
    result: string | null;
    roundStatus: RoundStatus;
    appliedAt: string | null;
  }> {
    const normalizedResult = this.normalizeManualResult(result);

    const outcome = await this.dataSource.transaction(async (manager) => {
      const txRoundRepo = manager.getRepository(LottoRound);
      const txResultRepo = manager.getRepository(LottoResult);

      const round = await txRoundRepo.findOne({
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!round) {
        throw new NotFoundException('ROUND_NOT_FOUND');
      }

      if (this.isTerminalNonSettlableRoundStatus(round.status)) {
        throw new ConflictException('ROUND_NOT_DRAWABLE');
      }

      // Already finalized — nothing to change (idempotent).
      if (round.resultId) {
        const existing = await txResultRepo.findOne({
          where: { id: round.resultId },
        });

        return {
          mode: 'ALREADY_FINALIZED' as const,
          round,
          previousResult: null,
          existingResult: this.normalizeResultValue(existing?.result),
        };
      }

      const existingRow = await txResultRepo.findOne({
        where: { roundId: round.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (existingRow && existingRow.status === ResultStatus.FINALIZED) {
        return {
          mode: 'ALREADY_FINALIZED' as const,
          round,
          previousResult: null,
          existingResult: this.normalizeResultValue(existingRow.result),
        };
      }

      // Draw time has passed → the existing finalize path applies it now.
      if (round.drawAt.getTime() <= Date.now()) {
        return {
          mode: 'FINALIZE' as const,
          round,
          previousResult: this.normalizeResultValue(existingRow?.result),
          existingResult: null,
        };
      }

      // CUTOFF GUARD — an admin lock is a final-result write, so it may only
      // land once betting is closed (now >= cutoffAt). Locking before the
      // cutoff would persist a final result while tickets are still accepted,
      // violating the cutoff-first timing rule; reject it instead. After the
      // cutoff the lock path below is safe: purchaseTicket already rejects
      // non-OPEN rounds, so no new bet can be influenced by (or influence)
      // the locked value.
      if (round.cutoffAt.getTime() > Date.now()) {
        throw new ConflictException('RESULT_LOCK_BEFORE_CUTOFF');
      }

      // Cutoff reached (draw still in future) → LOCK the symbol until draw.
      const row = existingRow ?? txResultRepo.create({ roundId: round.id });
      row.result = normalizedResult;
      row.source = ResultSource.ADMIN;
      row.adminId = adminId;
      row.status = ResultStatus.GENERATED;
      row.finalizedAt = null;
      await txResultRepo.save(row);

      return {
        mode: 'LOCKED' as const,
        round,
        previousResult: this.normalizeResultValue(existingRow?.result),
        existingResult: null,
      };
    });

    if (outcome.mode === 'ALREADY_FINALIZED') {
      return {
        finalized: false,
        locked: false,
        result: outcome.existingResult,
        roundStatus: outcome.round.status,
        appliedAt: null,
      };
    }

    if (outcome.mode === 'LOCKED') {
      await this.writeAuditLog({
        adminId,
        action: 'LOCK_RESULT',
        targetType: 'lotto_round',
        targetId: roundId,
        oldValue: { lockedResult: outcome.previousResult },
        newValue: {
          result: normalizedResult,
          resultSource: 'ADMIN',
          status: 'LOCKED',
          drawAt: outcome.round.drawAt.toISOString(),
        },
        metadata: {
          roundId,
          roundNumber: outcome.round.roundNumber,
          category: outcome.round.category,
          result: normalizedResult,
          resultSource: 'ADMIN',
          lockedUntilDrawAt: outcome.round.drawAt.toISOString(),
          reason: reason?.trim() || undefined,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return {
        finalized: false,
        locked: true,
        result: normalizedResult,
        roundStatus: outcome.round.status,
        appliedAt: null,
      };
    }

    const finalized = await this.finalizeRoundResult(
      roundId,
      normalizedResult,
      'ADMIN',
      adminId,
      {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        reason,
      },
    );

    const round = await this.roundRepo.findOne({ where: { id: roundId } });

    return {
      finalized: finalized.finalized,
      locked: false,
      result: finalized.result,
      roundStatus: round?.status ?? RoundStatus.RESULTED,
      appliedAt: new Date().toISOString(),
    };
  }

  private normalizeManualResult(result: string | null | undefined): string {
    const normalized = this.normalizeResultValue(result);
    if (!normalized || !VALID_RESULT_VALUES.has(normalized)) {
      throw new BadRequestException('INVALID_RESULT_VALUE');
    }
    return normalized;
  }

  /**
   * Resolves the result of a SERVER draw for one round.
   *
   * - `VERIFIED_RANDOM` keeps a strict uniform draw (never steered).
   * - `RANDOM` strategy → uniform random symbol.
   * - `HIGH` / `MEDIUM` / `LOW` → the symbol selected by the win-potential
   *   ladder (see LottoWinStrategyService). If the ladder has no stake signal
   *   the service already falls back to a uniform random symbol.
   *
   * Any analysis failure degrades gracefully to a uniform random symbol so a
   * draw can never be blocked by the strategy layer.
   */
  private async generateServerResult(
    manager: EntityManager,
    roundId: number,
  ): Promise<string> {
    const controls = await this.getLottoRuntimeControls(manager);

    if (
      controls.winStrategy === 'RANDOM' ||
      controls.resultMode === 'VERIFIED_RANDOM'
    ) {
      return this.randomResultSymbol();
    }

    try {
      const selection = await this.winStrategyService.selectServerResult(
        manager,
        roundId,
        controls.winStrategy,
      );

      if (selection.picked) {
        this.logger.log(
          `Round ${roundId} drawn by strategy ${controls.winStrategy}: ${selection.result} (win potential ${selection.picked.winPotential})`,
        );
      }

      return selection.result;
    } catch (error) {
      this.logger.warn(
        `Win strategy ${controls.winStrategy} failed for round ${roundId} — using a random draw: ${(error as Error).message}`,
      );
      return this.randomResultSymbol();
    }
  }

  private randomResultSymbol(): string {
    const index = randomInt(VALID_RESULT_VALUES_ARRAY.length);
    return VALID_RESULT_VALUES_ARRAY[index];
  }

  async getRoundById(roundId: number) {
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
      relations: {
        result: true,
      },
    });

    if (!round) {
      throw new NotFoundException('ROUND_NOT_FOUND');
    }

    return {
      round: this.toRoundView(round),
    };
  }

  async getMyTickets(userId: string, query: TicketListQuery = {}) {
    const safeLimit =
      typeof query.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(100, query.limit))
        : 20;

    const safeOffset =
      typeof query.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, query.offset)
        : 0;

    const where: {
      userId: string;
      roundId?: number;
      status?: TicketStatus;
      category?: Category;
    } = {
      userId,
    };

    if (typeof query.roundId === 'number' && Number.isInteger(query.roundId)) {
      where.roundId = query.roundId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      where.category = query.category;
    }

    const [tickets, total] = await this.ticketRepo.findAndCount({
      where,
      order: {
        createdAt: 'DESC',
      },
      take: safeLimit,
      skip: safeOffset,
    });

    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      items: tickets.map((ticket) => this.toTicketView(ticket)),
    };
  }

  async getTicketById(userId: string, ticketId: number) {
    const ticket = await this.ticketRepo.findOne({
      where: {
        id: ticketId,
        userId,
      },
      relations: {
        settlement: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('TICKET_NOT_FOUND');
    }

    return {
      ticket: this.toTicketView(ticket),
    };
  }

  async getRecentResults(query: { limit?: number; offset?: number; category?: Category } = {}) {
    const safeLimit =
      typeof query.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(100, query.limit))
        : 20;

    const safeOffset =
      typeof query.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, query.offset)
        : 0;

    // PUBLICATION IS DRIVEN BY SERVER TIME, NOT BY THE ENGINE TICK.
    //
    // A result prepared at the cutoff (status=GENERATED) becomes official the
    // instant server time crosses its round's drawAt. Selecting it here — with
    // the drawAt gate — means the value is readable at exactly 00:00 even if
    // the engine tick that flips/separates it runs up to one interval later.
    // Admin pre-locks for rounds whose drawAt is still in the future stay
    // hidden, because they fail the same gate.
    const publishedFrom = new Date();

    const where: FindOptionsWhere<LottoResult> = {
      status: In([ResultStatus.FINALIZED, ResultStatus.GENERATED]),
      round: {
        drawAt: LessThanOrEqual(publishedFrom),
        ...(query.category ? { category: query.category } : {}),
      },
    };

    const [results, total] = await this.resultRepo.findAndCount({
      relations: {
        round: true,
      },
      where,
      order: {
        // Newest PERIOD first — never insert order, so a late-created row for
        // an older round can never be shown as the latest result.
        round: {
          drawAt: 'DESC',
        },
        id: 'DESC',
      },
      take: safeLimit,
      skip: safeOffset,
    });

    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      items: results.map((result) => ({
        id: result.id,
        roundId: result.roundId,
        roundNumber: result.round?.roundNumber ?? null,
        category: result.round?.category ?? null,
        status: result.round?.status ?? null,
        result: this.normalizeResultValue(result.result),
        resultSource: result.source,
        generatedAt: result.generatedAt?.toISOString() ?? null,
        finalizedAt: result.finalizedAt?.toISOString() ?? null,
        drawAt: result.round?.drawAt?.toISOString() ?? null,
        // Earliest instant this value is public (= the round's draw time).
        revealAt: result.round?.drawAt?.toISOString() ?? null,
      })),
    };
  }

  async getResultByRoundId(roundId: number) {
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
      relations: {
        result: true,
      },
    });

    if (!round) {
      throw new NotFoundException('ROUND_NOT_FOUND');
    }

    // Same server-time publication gate as getRecentResults: a result prepared
    // at the cutoff is readable from drawAt onwards, and a not-yet-drawn
    // admin pre-lock stays hidden.
    const isDrawn = round.drawAt.getTime() <= Date.now();

    const roundResult = isDrawn
      ? (round.result ??
        (await this.resultRepo.findOne({
          where: {
            roundId: round.id,
            status: In([ResultStatus.FINALIZED, ResultStatus.GENERATED]),
          },
        })))
      : null;

    if (!roundResult) {
      throw new NotFoundException('ROUND_RESULT_NOT_FOUND');
    }

    return {
      result: {
        id: roundResult.id,
        roundId: round.id,
        roundNumber: round.roundNumber,
        category: round.category,
        status: round.status,
        result: this.normalizeResultValue(roundResult.result),
        resultSource: roundResult.source,
        generatedAt: roundResult.generatedAt?.toISOString() ?? null,
        finalizedAt: roundResult.finalizedAt?.toISOString() ?? null,
        drawAt: round.drawAt?.toISOString() ?? null,
        revealAt: round.drawAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Purchase ticket with ACID transaction
   */
  async purchaseTicket(
    userId: string,
    roundId: number,
    amount: number,
    selectedNumbers: string[],
    idempotencyKey?: string,
  ) {
    const normalizedIdempotencyKey = idempotencyKey?.trim() || null;
    const normalizedSelectedNumbers =
      this.normalizeSelectedNumbers(selectedNumbers);

    if (
      normalizedIdempotencyKey &&
      (normalizedIdempotencyKey.length < 8 ||
        normalizedIdempotencyKey.length > 128)
    ) {
      throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
    }

    // Validate
    await this.validatePurchase(
      userId,
      roundId,
      amount,
      normalizedSelectedNumbers,
    );

    if (normalizedIdempotencyKey) {
      const existingBeforeTransaction =
        await this.findExistingTicketByIdempotency(
          userId,
          normalizedIdempotencyKey,
        );

      if (existingBeforeTransaction) {
        return existingBeforeTransaction;
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let committed = false;

    try {
      const controls = await this.getLottoRuntimeControls(queryRunner.manager);
      if (controls.paused) {
        throw new ConflictException('LOTTO_PAUSED');
      }

      const lockedRound = await queryRunner.manager.findOne(LottoRound, {
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedRound) {
        throw new NotFoundException('ROUND_NOT_FOUND');
      }

      if (lockedRound.status === RoundStatus.CANCELLED) {
        throw new ConflictException('ROUND_CANCELLED');
      }

      if (lockedRound.status !== RoundStatus.OPEN) {
        throw new ConflictException('PERIOD_NOT_OPEN');
      }

      if (new Date() > lockedRound.cutoffAt) {
        throw new ConflictException('CUTOFF_PASSED');
      }

      if (normalizedIdempotencyKey) {
        const existingInTransaction = await queryRunner.manager.findOne(
          LottoTicket,
          {
            where: {
              userId,
              idempotencyKey: normalizedIdempotencyKey,
            },
            lock: { mode: 'pessimistic_read' },
            order: {
              id: 'DESC',
            },
          },
        );

        if (existingInTransaction) {
          await queryRunner.commitTransaction();
          committed = true;
          return existingInTransaction;
        }
      }

      // 1. Lock user row for update
      const user = await queryRunner.manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .getOne();

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const ticketAmount = this.parseAmount(amount);
      const userBalance = await this.getOrCreateBalanceForUpdate(
        queryRunner,
        userId,
      );
      const roundLiquiditySetting = await queryRunner.manager.findOne(
        AdminSetting,
        {
          where: { key: PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY },
          lock: { mode: 'pessimistic_write' },
        },
      );

      const poolBalance = this.parseLiquidityPoolBalanceWithFallback(
        roundLiquiditySetting?.value,
      );
      const reservedLiquidity =
        await this.getReservedLiquidityForTicketPlacement(queryRunner.manager);
      const availableLiquidity = Decimal.max(
        poolBalance.minus(reservedLiquidity),
        0,
      );
      const reservationRequired = ticketAmount
        .mul('0.97')
        .mul(new Decimal(16).div(normalizedSelectedNumbers.length))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      if (availableLiquidity.lt(reservationRequired)) {
        throw new ConflictException('INSUFFICIENT_LOTTO_LIQUIDITY');
      }

      const availableBefore = this.parseAmount(userBalance.availableBalance);
      if (availableBefore.lt(ticketAmount)) {
        throw new ConflictException('INSUFFICIENT_BALANCE');
      }

      const availableAfter = availableBefore.minus(ticketAmount);
      const totalBefore = this.parseAmount(userBalance.totalBalance);
      const totalAfter = totalBefore.minus(ticketAmount);

      userBalance.availableBalance = availableAfter.toFixed(18);
      userBalance.totalBalance = totalAfter.toFixed(18);
      userBalance.lastUpdatedAt = new Date();
      await queryRunner.manager.save(userBalance);

      // 2. Create ticket
      const ticket = new LottoTicket();
      ticket.ticketNumber = this.generateTicketNumber(roundId);
      ticket.userId = userId;
      ticket.roundId = roundId;
      ticket.category = lockedRound.category;
      ticket.roundNumber = lockedRound.roundNumber;
      ticket.amount = this.to2Dp(ticketAmount);
      ticket.deductionAmount = this.to2Dp(ticketAmount.mul('0.03'));
      ticket.referralAmount = this.to2Dp(ticketAmount.mul('0.02'));
      ticket.adminAmount = this.to2Dp(ticketAmount.mul('0.01'));
      ticket.netAmount = this.to2Dp(ticketAmount.mul('0.97'));
      ticket.selectedNumbers = normalizedSelectedNumbers.join(',');
      ticket.selectionCount = normalizedSelectedNumbers.length;
      ticket.multiplier = Number(
        new Decimal(16).div(normalizedSelectedNumbers.length).toFixed(6),
      );
      ticket.maxPayoutLiability = this.to2Dp(
        this.parseAmount(ticket.netAmount).mul(ticket.multiplier),
      );
      ticket.reservedAmount = ticket.maxPayoutLiability;
      ticket.reservationStatus = ReservationStatus.RESERVED;
      ticket.idempotencyKey = normalizedIdempotencyKey;
      ticket.status = TicketStatus.ACTIVE;

      const savedTicket = await queryRunner.manager.save(ticket);

      // 3. Create ledger entry (debit)
      const ledgerEntry = new LedgerEntry();
      ledgerEntry.userId = user.id;
      ledgerEntry.type = LedgerType.GAME_ENTRY;
      ledgerEntry.amount = ticketAmount.toFixed(18);
      ledgerEntry.balanceBefore = availableBefore.toFixed(18);
      ledgerEntry.balanceAfter = availableAfter.toFixed(18);
      ledgerEntry.referenceType = 'LOTTO_TICKET';
      ledgerEntry.referenceId = savedTicket.id.toString();
      ledgerEntry.description = `LOTTO ticket purchase - Round ${roundId}`;
      ledgerEntry.metadata = {
        roundId,
        ticketId: savedTicket.id,
        debitSource: 'AVAILABLE_BALANCE',
      };

      const savedTx = await queryRunner.manager.save(ledgerEntry);

      // 4. Update ticket with transaction ID
      savedTicket.purchaseTxId = savedTx.id;
      await queryRunner.manager.save(savedTicket);

      // 6. Distribute referral bonuses
      await this.distributeReferrals(queryRunner, savedTicket, userId);

      // 7. Add to admin pool
      await this.addToAdminPool(
        queryRunner,
        savedTicket.adminAmount,
        savedTicket.id,
        userId,
      );

      // 8. Update round totals
      await queryRunner.manager
        .createQueryBuilder()
        .update(LottoRound)
        .set({
          totalTickets: () => '"totalTickets" + 1',
          totalAmount: () => '"totalAmount" + :ticketAmount',
        })
        .setParameter('ticketAmount', ticket.amount)
        .where('id = :roundId', { roundId })
        .execute();

      await queryRunner.commitTransaction();
      committed = true;

      return savedTicket;
    } catch (error) {
      if (!committed) {
        await queryRunner.rollbackTransaction();
      }

      if (
        normalizedIdempotencyKey &&
        this.isTicketIdempotencyUniqueViolation(error)
      ) {
        const replayTicket = await this.findExistingTicketByIdempotency(
          userId,
          normalizedIdempotencyKey,
        );
        if (replayTicket) {
          return replayTicket;
        }
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findExpiredRoundIdsForSettlement(
    limit = this.getRoundSettlementBatchSize(),
  ): Promise<number[]> {
    const now = new Date();

    const rounds = await this.roundRepo.find({
      where: {
        status: In(ACTIVE_ROUND_SETTLEMENT_STATUSES),
        drawAt: LessThanOrEqual(now),
      },
      order: { drawAt: 'ASC', createdAt: 'ASC' },
      take: limit,
    });

    return rounds.map((round) => round.id);
  }

  async settleRound(roundId: number): Promise<RoundSettlementResult> {
    const now = new Date();

    const preloadedRound = await this.roundRepo.findOne({
      where: { id: roundId },
    });
    if (!preloadedRound) {
      throw new NotFoundException('ROUND_NOT_FOUND');
    }

    const preloadedTransition = this.getRoundSettlementTransition(
      preloadedRound,
      now,
    );
    if (preloadedTransition === 'NOOP') {
      return this.toRoundSettlementResultWithRepository(
        preloadedRound,
        this.resultRepo,
      );
    }
    if (preloadedTransition === 'REJECT_NOT_READY') {
      throw new ConflictException('ROUND_NOT_READY_FOR_SETTLEMENT');
    }
    if (preloadedTransition === 'REJECT_NOT_DRAWN') {
      throw new ConflictException('ROUND_NOT_DRAWN');
    }

    const { round: settledRound, normalizedResult } =
      await this.dataSource.transaction(async (manager) => {
        const txRoundRepo = manager.getRepository(LottoRound);
        const txTicketRepo = manager.getRepository(LottoTicket);
        const txResultRepo = manager.getRepository(LottoResult);

        const round = await txRoundRepo.findOne({
          where: { id: roundId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!round) {
          throw new NotFoundException('ROUND_NOT_FOUND');
        }

        const transition = this.getRoundSettlementTransition(round, now);
        if (transition === 'NOOP') {
          const existingResult = await txResultRepo.findOne({
            where: { roundId: round.id },
          });

          return {
            round,
            normalizedResult: this.normalizeResultValue(existingResult?.result),
          };
        }

        if (transition === 'REJECT_NOT_READY') {
          throw new ConflictException('ROUND_NOT_READY_FOR_SETTLEMENT');
        }

        if (transition === 'REJECT_NOT_DRAWN') {
          throw new ConflictException('ROUND_NOT_DRAWN');
        }

        const roundResult = await this.getRoundResultForSettlement(
          txResultRepo,
          round.id,
          round.resultId,
        );

        if (!roundResult) {
          throw new ConflictException('ROUND_RESULT_NOT_AVAILABLE');
        }

        const normalizedResult = this.normalizeResultValue(roundResult.result);
        if (!normalizedResult || !VALID_RESULT_VALUES.has(normalizedResult)) {
          throw new ConflictException('ROUND_RESULT_INVALID');
        }

        const tickets = await txTicketRepo.find({
          where: { roundId: round.id },
          order: { id: 'ASC' },
        });

        const settledAt = new Date();

        for (const ticket of tickets) {
          await this.settleTicketForRound(
            manager,
            ticket,
            normalizedResult,
            settledAt,
          );
        }

        round.status = RoundStatus.SETTLED;
        round.settledAt = settledAt;
        round.errorMessage = null;
        round.failedAt = null;

        const savedRound = await txRoundRepo.save(round);

        return {
          round: savedRound,
          normalizedResult,
        };
      });

    return this.toRoundSettlementResult(settledRound, normalizedResult);
  }

  async markRoundSettlementFailed(
    roundId: number,
    reason: string,
    attemptsMade?: number,
    maxAttempts?: number,
  ): Promise<boolean> {
    const updateResult = await this.roundRepo.update(
      {
        id: roundId,
        status: In(ACTIVE_ROUND_SETTLEMENT_STATUSES),
      },
      {
        status: RoundStatus.FAILED,
        errorMessage: reason,
        failedAt: new Date(),
      },
    );

    const updated = Number(updateResult.affected ?? 0) > 0;

    if (updated) {
      this.logger.warn(
        `Round ${roundId} moved to FAILED after settlement retries exhausted` +
          `${
            maxAttempts
              ? ` (${attemptsMade ?? maxAttempts}/${maxAttempts})`
              : attemptsMade
                ? ` (${attemptsMade})`
                : ''
          }: ${reason}`,
      );
    }

    return updated;
  }

  async refundCancelledRound(
    roundId: number,
  ): Promise<{ refundedTickets: number }> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const txRoundRepo = manager.getRepository(LottoRound);
      const txTicketRepo = manager.getRepository(LottoTicket);
      const txLedgerRepo = manager.getRepository(LedgerEntry);
      const txReferralRepo = manager.getRepository(ReferralBonus);

      const round = await txRoundRepo.findOne({
        where: { id: roundId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!round) {
        throw new NotFoundException('ROUND_NOT_FOUND');
      }

      const refundTransition = this.getRoundRefundTransition(round);
      if (refundTransition === 'NOOP') {
        return { refundedTickets: 0 };
      }

      if (refundTransition === 'REJECT_NOT_CANCELLED') {
        throw new ConflictException('ROUND_NOT_CANCELLED');
      }

      const tickets = await txTicketRepo.find({
        where: { roundId: round.id },
        order: { id: 'ASC' },
      });

      let refundedTickets = 0;
      const refundedAt = new Date();

      for (const preloadedTicket of tickets) {
        if (this.isTerminalTicketStatus(preloadedTicket.status)) {
          continue;
        }

        const ticket = await txTicketRepo.findOne({
          where: { id: preloadedTicket.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!ticket || this.isTerminalTicketStatus(ticket.status)) {
          continue;
        }

        const userBalance = await this.getOrCreateBalanceForUpdateByManager(
          manager,
          ticket.userId,
        );

        const refundAmount = this.parseAmount(ticket.amount);
        const availableBefore = this.parseAmount(userBalance.availableBalance);
        const availableAfter = availableBefore.plus(refundAmount);
        const totalAfter = this.parseAmount(userBalance.totalBalance).plus(
          refundAmount,
        );

        userBalance.availableBalance = availableAfter.toFixed(18);
        userBalance.totalBalance = totalAfter.toFixed(18);
        userBalance.lastUpdatedAt = refundedAt;
        await manager.save(userBalance);

        const refundLedgerEntry = txLedgerRepo.create({
          userId: ticket.userId,
          type: LedgerType.GAME_WIN,
          amount: refundAmount.toFixed(18),
          balanceBefore: availableBefore.toFixed(18),
          balanceAfter: availableAfter.toFixed(18),
          referenceType: 'LOTTO_REFUND',
          referenceId: ticket.id.toString(),
          description: `LOTTO cancelled round refund - Round ${round.id}`,
          metadata: {
            roundId: round.id,
            ticketId: ticket.id,
            reservationRelease: ticket.reservedAmount,
            refundReason: 'ROUND_CANCELLED',
          },
        });

        const savedRefundLedger = await manager.save(refundLedgerEntry);

        ticket.status = TicketStatus.REFUNDED;
        ticket.refundTxId = savedRefundLedger.id;
        ticket.refundedAt = refundedAt;
        ticket.winAmount = this.to2Dp(refundAmount);
        ticket.reservationStatus = ReservationStatus.RELEASED;
        ticket.reservedAmount = 0;
        await txTicketRepo.save(ticket);

        await txReferralRepo.update(
          {
            ticketId: ticket.id,
            status: ReferralStatus.DISTRIBUTED,
          },
          {
            status: ReferralStatus.REVERSED,
          },
        );

        refundedTickets += 1;
      }

      round.status = RoundStatus.REFUNDED;
      round.refundedAt = refundedAt;
      round.errorMessage = null;
      await txRoundRepo.save(round);

      return { refundedTickets };
    });

    return outcome;
  }

  /**
   * Generate unique ticket number
   */
  private generateTicketNumber(roundId: number): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const entropy = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    return `LOTTO-${roundId}-${timestamp}-${entropy}`;
  }

  /**
   * Distribute referral bonuses (6 levels)
   */
  private async distributeReferrals(
    queryRunner: QueryRunner,
    ticket: LottoTicket,
    userId: string,
  ) {
    const referralLevels = {
      L1: 0.0075, // 0.75%
      L2: 0.0035, // 0.35%
      L3: 0.0025, // 0.25%
      L4: 0.0025, // 0.25%
      L5: 0.002, // 0.20%
      L6: 0.002, // 0.20%
    };

    // Get referral chain
    const chain = await this.getReferralChain(queryRunner, userId, 6);

    for (let i = 0; i < chain.length && i < 6; i++) {
      const referrer = chain[i];
      const level = `L${i + 1}`;
      const bonusPercent = referralLevels[level as keyof typeof referralLevels];
      const bonusAmount = this.parseAmount(ticket.amount)
        .mul(bonusPercent)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      if (bonusAmount.gt(0)) {
        const referrerBalance = await this.getOrCreateBalanceForUpdate(
          queryRunner,
          referrer.id,
        );

        const availableBefore = this.parseAmount(
          referrerBalance.availableBalance,
        );
        const availableAfter = availableBefore.plus(bonusAmount);
        const totalAfter = this.parseAmount(referrerBalance.totalBalance).plus(
          bonusAmount,
        );

        referrerBalance.availableBalance = availableAfter.toFixed(18);
        referrerBalance.totalBalance = totalAfter.toFixed(18);
        referrerBalance.lastUpdatedAt = new Date();
        await queryRunner.manager.save(referrerBalance);

        // Create referral bonus
        const bonus = new ReferralBonus();
        bonus.userId = referrer.id;
        bonus.referrerId = userId;
        bonus.ticketId = ticket.id;
        bonus.level = level;
        bonus.amount = this.to2Dp(bonusAmount);
        bonus.percentage =
          referralLevels[level as keyof typeof referralLevels] * 100;
        bonus.status = ReferralStatus.DISTRIBUTED;
        bonus.distributedAt = new Date();

        const savedBonus = await queryRunner.manager.save(bonus);

        // Create transaction
        const ledgerEntry = new LedgerEntry();
        ledgerEntry.userId = referrer.id;
        ledgerEntry.type = LedgerType.GAME_WIN;
        ledgerEntry.amount = bonusAmount.toFixed(18);
        ledgerEntry.balanceBefore = availableBefore.toFixed(18);
        ledgerEntry.balanceAfter = availableAfter.toFixed(18);
        ledgerEntry.referenceType = 'REFERRAL_BONUS';
        ledgerEntry.referenceId = savedBonus.id.toString();
        ledgerEntry.description = `LOTTO referral bonus - Level ${level}`;
        ledgerEntry.metadata = {
          ticketId: ticket.id,
          level,
          sourceUserId: userId,
          recipientUserId: referrer.id,
        };

        const savedTx = await queryRunner.manager.save(ledgerEntry);

        // Update bonus with transaction ID
        savedBonus.transactionId = savedTx.id;
        await queryRunner.manager.save(savedBonus);
      }
    }
  }

  /**
   * Get referral chain (6 levels deep)
   */
  private async getReferralChain(
    queryRunner: QueryRunner,
    userId: string,
    depth: number,
  ): Promise<User[]> {
    const chain: User[] = [];
    let currentId = userId;

    for (let i = 0; i < depth; i++) {
      const user = await queryRunner.manager.findOne(User, {
        where: { id: currentId },
        select: {
          id: true,
          referredBy: true,
        },
      });

      if (!user || !user.referredBy) break;

      const referrer = await queryRunner.manager.findOne(User, {
        where: { id: user.referredBy },
      });

      if (!referrer) break;

      chain.push(referrer);
      currentId = referrer.id;
    }

    return chain;
  }

  /**
   * Add to admin pool
   */
  private async addToAdminPool(
    queryRunner: QueryRunner,
    amount: number,
    ticketId: number,
    userId: string,
  ) {
    const allocationAmount = this.parseAmount(amount).toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP,
    );

    if (allocationAmount.lte(0)) {
      return;
    }

    let pool = await queryRunner.manager.findOne(AdminPool, {
      where: {},
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    if (!pool) {
      pool = new AdminPool();
      pool.totalBalance = 0;
      pool.lockedBalance = 0;
      pool.availableBalance = 0;
      pool.totalDeposited = 0;
      pool.totalWithdrawn = 0;
      await queryRunner.manager.save(pool);
    }

    const balanceBefore = this.parseAmount(pool.totalBalance);
    const balanceAfter = balanceBefore.plus(allocationAmount);
    const availableAfter = this.parseAmount(pool.availableBalance).plus(
      allocationAmount,
    );
    const depositedAfter = this.parseAmount(pool.totalDeposited).plus(
      allocationAmount,
    );

    pool.totalBalance = this.to2Dp(balanceAfter);
    pool.availableBalance = this.to2Dp(availableAfter);
    pool.totalDeposited = this.to2Dp(depositedAfter);
    await queryRunner.manager.save(pool);

    const poolTx = new AdminPoolTransaction();
    poolTx.adminPoolId = pool.id;
    poolTx.type = AdminPoolTxType.DEPOSIT;
    poolTx.amount = this.to2Dp(allocationAmount);
    poolTx.balanceBefore = this.to2Dp(balanceBefore);
    poolTx.balanceAfter = this.to2Dp(balanceAfter);
    poolTx.description = `LOTTO admin allocation from ticket ${ticketId}`;
    poolTx.referenceId = `LOTTO_TICKET_${ticketId}`;
    poolTx.userId = userId;
    poolTx.metadata = {
      ticketId,
      source: 'LOTTO_TICKET_PURCHASE',
    };

    await queryRunner.manager.save(poolTx);
  }

  private async settleTicketForRound(
    manager: EntityManager,
    preloadedTicket: LottoTicket,
    normalizedResult: string,
    settledAt: Date,
  ): Promise<void> {
    const txTicketRepo = manager.getRepository(LottoTicket);
    const txSettlementRepo = manager.getRepository(LottoSettlement);
    const txLedgerRepo = manager.getRepository(LedgerEntry);

    const ticket = await txTicketRepo.findOne({
      where: { id: preloadedTicket.id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!ticket) {
      return;
    }

    if (this.isTerminalTicketStatus(ticket.status)) {
      return;
    }

    const selectedNumbers = ticket.selectedNumbers
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0);

    const isWin = selectedNumbers.includes(normalizedResult);
    const calculatedPayout = isWin
      ? this.parseAmount(ticket.netAmount)
          .mul(this.parseAmount(ticket.multiplier))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal(0);

    let settlementTxId: string | null = null;

    if (isWin && calculatedPayout.gt(0)) {
      const userBalance = await this.getOrCreateBalanceForUpdateByManager(
        manager,
        ticket.userId,
      );

      const availableBefore = this.parseAmount(userBalance.availableBalance);
      const availableAfter = availableBefore.plus(calculatedPayout);
      const totalAfter = this.parseAmount(userBalance.totalBalance).plus(
        calculatedPayout,
      );

      userBalance.availableBalance = availableAfter.toFixed(18);
      userBalance.totalBalance = totalAfter.toFixed(18);
      userBalance.lastUpdatedAt = settledAt;
      await manager.save(userBalance);

      const ledgerEntry = txLedgerRepo.create({
        userId: ticket.userId,
        type: LedgerType.GAME_WIN,
        amount: calculatedPayout.toFixed(18),
        balanceBefore: availableBefore.toFixed(18),
        balanceAfter: availableAfter.toFixed(18),
        referenceType: 'LOTTO_SETTLEMENT',
        referenceId: ticket.id.toString(),
        description: `LOTTO ticket settlement WIN - Round ${ticket.roundId}`,
        metadata: {
          roundId: ticket.roundId,
          ticketId: ticket.id,
          result: normalizedResult,
          outcome: SettlementOutcome.WIN,
          multiplier: ticket.multiplier,
          netAmount: ticket.netAmount,
          payout: calculatedPayout.toFixed(2),
        },
      });

      const savedLedgerEntry = await manager.save(ledgerEntry);
      settlementTxId = savedLedgerEntry.id;
    }

    ticket.status = TicketStatus.SETTLED;
    ticket.winAmount = this.to2Dp(calculatedPayout);
    ticket.settlementTxId = settlementTxId;
    ticket.settledAt = settledAt;
    ticket.reservationStatus = isWin
      ? ReservationStatus.CONSUMED
      : ReservationStatus.RELEASED;
    ticket.reservedAmount = 0;
    await txTicketRepo.save(ticket);

    const existingSettlement = await txSettlementRepo.findOne({
      where: { ticketId: ticket.id },
      lock: { mode: 'pessimistic_write' },
    });

    const settlement = existingSettlement ?? txSettlementRepo.create();
    settlement.ticketId = ticket.id;
    settlement.userId = ticket.userId;
    settlement.roundId = ticket.roundId;
    settlement.result = normalizedResult;
    settlement.outcome = isWin ? SettlementOutcome.WIN : SettlementOutcome.LOSS;
    settlement.calculatedPayout = this.to2Dp(calculatedPayout);
    settlement.payoutAmount = this.to2Dp(calculatedPayout);
    settlement.status = SettlementStatus.SETTLED;
    settlement.settledAt = settledAt;

    await txSettlementRepo.save(settlement);
  }

  private async getRoundResultForSettlement(
    resultRepo: Repository<LottoResult>,
    roundId: number,
    resultId: number | null | undefined,
  ): Promise<LottoResult | null> {
    if (resultId) {
      const resultById = await resultRepo.findOne({ where: { id: resultId } });
      if (resultById) {
        return resultById;
      }
    }

    return resultRepo.findOne({ where: { roundId } });
  }

  private normalizeResultValue(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeSelectedNumbers(selectedNumbers: string[]): string[] {
    return selectedNumbers.map((num) => num.trim().toUpperCase());
  }

  private async getReservedLiquidityForTicketPlacement(
    manager: EntityManager,
  ): Promise<Decimal> {
    const raw = await manager
      .getRepository(LottoTicket)
      .createQueryBuilder('ticket')
      .select('COALESCE(SUM(ticket.reservedAmount), 0)', 'reservedAmount')
      .where('ticket.reservationStatus = :reservationStatus', {
        reservationStatus: ReservationStatus.RESERVED,
      })
      .getRawOne<{ reservedAmount?: string | number | null }>();

    return Decimal.max(this.parseAmount(raw?.reservedAmount ?? '0'), 0);
  }

  private parseLiquidityPoolBalanceWithFallback(
    value: string | number | null | undefined,
  ): Decimal {
    if (value === null || value === undefined) {
      return new Decimal(0);
    }

    try {
      return Decimal.max(this.parseAmount(value), 0);
    } catch {
      this.logger.warn(
        `Invalid ${PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY} value encountered, defaulting to 0`,
      );
      return new Decimal(0);
    }
  }

  private isTicketIdempotencyUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const driverError =
      'driverError' in error
        ? (error as { driverError?: { code?: string; constraint?: string } })
            .driverError
        : undefined;

    if (!driverError) {
      return false;
    }

    return (
      driverError.code === '23505' &&
      driverError.constraint === 'IDX_lotto_tickets_user_idempotency_unique'
    );
  }

  private async findExistingTicketByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<LottoTicket | null> {
    return this.ticketRepo.findOne({
      where: {
        userId,
        idempotencyKey,
      },
      order: {
        id: 'DESC',
      },
    });
  }

  private async getLottoRuntimeControls(
    manager?: EntityManager,
  ): Promise<LottoRuntimeControls> {
    const settingRepo = manager
      ? manager.getRepository(AdminSetting)
      : this.adminSettingRepo;

    const [pausedSetting, resultModeSetting, winStrategySetting] =
      await Promise.all([
        settingRepo.findOne({ where: { key: LOTTO_PAUSED_SETTING_KEY } }),
        settingRepo.findOne({ where: { key: LOTTO_RESULT_MODE_SETTING_KEY } }),
        settingRepo.findOne({ where: { key: LOTTO_WIN_STRATEGY_SETTING_KEY } }),
      ]);

    const paused = this.parseBooleanSetting(pausedSetting?.value ?? null);
    const resultMode = this.normalizeResultModeSetting(
      resultModeSetting?.value ?? null,
    );
    const winStrategy = normalizeWinStrategy(winStrategySetting?.value ?? null);

    return {
      paused,
      resultMode,
      winStrategy,
    };
  }

  private parseBooleanSetting(value: string | null): boolean {
    if (!value) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }

    return false;
  }

  private normalizeResultModeSetting(value: string | null): string {
    const fallback = 'SERVER_RANDOM';
    if (!value) {
      return fallback;
    }

    const normalized = value.trim().toUpperCase();
    return SUPPORTED_LOTTO_RESULT_MODES.has(normalized) ? normalized : fallback;
  }

  private toRoundView(round: LottoRound) {
    const resultValue = this.normalizeResultValue(round.result?.result);

    return {
      id: round.id,
      roundNumber: round.roundNumber,
      category: round.category,
      status: round.status,
      startAt: round.startAt?.toISOString() ?? null,
      cutoffAt: round.cutoffAt?.toISOString() ?? null,
      drawAt: round.drawAt?.toISOString() ?? null,
      result: resultValue,
      resultSource: round.result?.source ?? null,
      resultGeneratedAt: round.resultGeneratedAt?.toISOString() ?? null,
      settledAt: round.settledAt?.toISOString() ?? null,
      refundedAt: round.refundedAt?.toISOString() ?? null,
      failedAt: round.failedAt?.toISOString() ?? null,
      totalTickets: round.totalTickets,
      totalAmount: this.to2Dp(this.parseAmount(round.totalAmount)),
    };
  }

  private toTicketView(ticket: LottoTicket) {
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      userId: ticket.userId,
      roundId: ticket.roundId,
      category: ticket.category,
      roundNumber: ticket.roundNumber,
      amount: this.to2Dp(this.parseAmount(ticket.amount)),
      deductionAmount: this.to2Dp(this.parseAmount(ticket.deductionAmount)),
      referralAmount: this.to2Dp(this.parseAmount(ticket.referralAmount)),
      adminAmount: this.to2Dp(this.parseAmount(ticket.adminAmount)),
      netAmount: this.to2Dp(this.parseAmount(ticket.netAmount)),
      selectedNumbers: ticket.selectedNumbers
        .split(',')
        .map((num) => num.trim())
        .filter((num) => num.length > 0),
      selectionCount: ticket.selectionCount,
      multiplier: Number(ticket.multiplier),
      maxPayoutLiability: this.to2Dp(
        this.parseAmount(ticket.maxPayoutLiability),
      ),
      reservedAmount: this.to2Dp(this.parseAmount(ticket.reservedAmount)),
      reservationStatus: ticket.reservationStatus,
      idempotencyKey: ticket.idempotencyKey,
      status: ticket.status,
      winAmount:
        ticket.winAmount === null
          ? null
          : this.to2Dp(this.parseAmount(ticket.winAmount)),
      purchaseTxId: ticket.purchaseTxId,
      settlementTxId: ticket.settlementTxId,
      refundTxId: ticket.refundTxId,
      settledAt: ticket.settledAt?.toISOString() ?? null,
      refundedAt: ticket.refundedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt?.toISOString() ?? null,
      updatedAt: ticket.updatedAt?.toISOString() ?? null,
    };
  }

  private isTerminalNonSettlableRoundStatus(status: RoundStatus): boolean {
    return TERMINAL_NON_SETTLABLE_ROUND_STATUSES.includes(status);
  }

  private isTerminalRoundStatus(status: RoundStatus): boolean {
    return TERMINAL_ROUND_STATUSES.includes(status);
  }

  private getRoundSettlementTransition(
    round: Pick<LottoRound, 'status' | 'drawAt'>,
    now: Date,
  ): 'SETTLE' | 'NOOP' | 'REJECT_NOT_READY' | 'REJECT_NOT_DRAWN' {
    if (this.isTerminalRoundStatus(round.status)) {
      return 'NOOP';
    }

    if (!ACTIVE_ROUND_SETTLEMENT_STATUSES.includes(round.status)) {
      return 'REJECT_NOT_READY';
    }

    if (round.drawAt.getTime() > now.getTime()) {
      return 'REJECT_NOT_DRAWN';
    }

    return 'SETTLE';
  }

  private getRoundRefundTransition(
    round: Pick<LottoRound, 'status'>,
  ): 'REFUND' | 'NOOP' | 'REJECT_NOT_CANCELLED' {
    if (round.status === RoundStatus.CANCELLED) {
      return 'REFUND';
    }

    if (this.isTerminalRoundStatus(round.status)) {
      return 'NOOP';
    }

    return 'REJECT_NOT_CANCELLED';
  }

  private isTerminalTicketStatus(status: TicketStatus): boolean {
    return TERMINAL_TICKET_STATUSES.includes(status);
  }

  private toRoundSettlementResult(
    round: LottoRound,
    result: string | null,
  ): RoundSettlementResult {
    return {
      roundId: round.id,
      status: round.status,
      result,
      settledAt: round.settledAt ? round.settledAt.toISOString() : null,
    };
  }

  private async toRoundSettlementResultWithRepository(
    round: LottoRound,
    resultRepo: Repository<LottoResult>,
  ): Promise<RoundSettlementResult> {
    const existingResult = await resultRepo.findOne({
      where: { roundId: round.id },
    });

    return this.toRoundSettlementResult(
      round,
      this.normalizeResultValue(existingResult?.result),
    );
  }

  private getRoundSettlementBatchSize(): number {
    const raw =
      this.configService.get<string>('LOTTO_SETTLEMENT_BATCH_SIZE') ?? '25';
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 25;
    }

    return Math.min(parsed, 200);
  }

  private async getOrCreateBalanceForUpdateByManager(
    manager: EntityManager,
    userId: string,
  ): Promise<Balance> {
    let balance = await manager.findOne(Balance, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (balance) {
      return balance;
    }

    const zero = '0.000000000000000000';
    balance = manager.create(Balance, {
      userId,
      availableBalance: zero,
      lockedBalance: zero,
      gameLocked: zero,
      tradingLocked: zero,
      withdrawalLocked: zero,
      totalBalance: zero,
    });

    return manager.save(balance);
  }

  private parseAmount(value: string | number | null | undefined): Decimal {
    return new Decimal(String(value ?? '0'));
  }

  private to2Dp(value: Decimal): number {
    return Number(value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
  }

  private async getOrCreateBalanceForUpdate(
    queryRunner: QueryRunner,
    userId: string,
  ): Promise<Balance> {
    let balance = await queryRunner.manager.findOne(Balance, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (balance) {
      return balance;
    }

    const zero = '0.000000000000000000';
    balance = queryRunner.manager.create(Balance, {
      userId,
      availableBalance: zero,
      lockedBalance: zero,
      gameLocked: zero,
      tradingLocked: zero,
      withdrawalLocked: zero,
      totalBalance: zero,
    });

    return queryRunner.manager.save(balance);
  }

  /**
   * Validate purchase
   */
  private async validatePurchase(
    userId: string,
    roundId: number,
    amount: number,
    selectedNumbers: string[],
  ) {
    // Validate round
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
    });

    if (!round) {
      throw new NotFoundException('Round not found');
    }

    if (round.status !== RoundStatus.OPEN) {
      throw new BadRequestException('Round is not open for tickets');
    }

    if (new Date() > round.cutoffAt) {
      throw new BadRequestException('Cutoff time passed');
    }

    // Validate amount
    if (amount < 1 || amount > 100000) {
      throw new BadRequestException('Amount must be between 1 and 100,000 TDX');
    }

    // Validate selections
    if (selectedNumbers.length < 1 || selectedNumbers.length > 15) {
      throw new BadRequestException('Select between 1 and 15 numbers');
    }

    const uniqueNumbers = new Set(selectedNumbers);
    if (uniqueNumbers.size !== selectedNumbers.length) {
      throw new BadRequestException('Duplicate numbers not allowed');
    }

    const validNumbers = [
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
    ];
    for (const num of selectedNumbers) {
      if (!validNumbers.includes(num)) {
        throw new BadRequestException(`Invalid number: ${num}`);
      }
    }
  }

  // ============================================================
  // ADMIN — dashboard, rounds, tickets, results, settings
  // ============================================================

  async getAdminDashboard() {
    const controls = await this.getLottoRuntimeControls();

    const categoryCards: AdminCategoryCard[] = [];
    const now = new Date();

    for (const category of ALL_LOTTO_CATEGORIES) {
      const currentRound = await this.roundRepo.findOne({
        where: { category },
        order: { id: 'DESC' },
        relations: { result: true },
      });

      if (!currentRound) {
        categoryCards.push({
          category,
          round: null,
          tickets: 0,
          volume: 0,
          reservedExposure: 0,
        });
        continue;
      }

      const roundTotals = await this.ticketRepo
        .createQueryBuilder('ticket')
        .select('COUNT(ticket.id)', 'ticketCount')
        .addSelect('COALESCE(SUM(ticket.amount), 0)', 'volume')
        .addSelect(
          "COALESCE(SUM(CASE WHEN ticket.reservationStatus = 'RESERVED' THEN ticket.reservedAmount ELSE 0 END), 0)",
          'reservedExposure',
        )
        .where('ticket.roundId = :roundId', { roundId: currentRound.id })
        .getRawOne<{
          ticketCount?: string | number;
          volume?: string | number;
          reservedExposure?: string | number;
        }>();

      const lockedResult = currentRound.resultId
        ? null
        : await this.findLockedAdminResult(currentRound.id);

      categoryCards.push({
        category,
        round: {
          id: currentRound.id,
          roundNumber: currentRound.roundNumber,
          status: currentRound.status,
          startAt: currentRound.startAt?.toISOString() ?? null,
          cutoffAt: currentRound.cutoffAt?.toISOString() ?? null,
          drawAt: currentRound.drawAt?.toISOString() ?? null,
          remainingSeconds: this.computeRoundRemainingSeconds(
            currentRound.drawAt,
            now,
          ),
          result: this.normalizeResultValue(currentRound.result?.result),
          resultSource: currentRound.result?.source ?? null,
          resultGeneratedAt:
            currentRound.resultGeneratedAt?.toISOString() ?? null,
          lockedResult: lockedResult?.result ?? null,
          lockedResultSource: lockedResult ? 'ADMIN' : null,
          lockedAt: lockedResult?.generatedAt?.toISOString() ?? null,
          settledAt: currentRound.settledAt?.toISOString() ?? null,
        },
        tickets: Number(roundTotals?.ticketCount ?? 0),
        volume: Number(roundTotals?.volume ?? 0),
        reservedExposure: Number(roundTotals?.reservedExposure ?? 0),
      });
    }

    const poolBalance = this.parseLiquidityPoolBalanceWithFallback(
      await this.getSettingValue(PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY),
    );
    const reservedLiquidity =
      await this.getReservedLiquidityForTicketPlacement(this.roundRepo.manager);

    const lifetimeTotals = await this.roundRepo
      .createQueryBuilder('round')
      .select('COALESCE(SUM(round.totalTickets), 0)', 'tickets')
      .addSelect('COALESCE(SUM(round.totalAmount), 0)', 'volume')
      .getRawOne<{
        tickets?: string | number;
        volume?: string | number;
      }>();

    const pendingSettlementRounds = await this.roundRepo.count({
      where: { status: RoundStatus.RESULTED },
    });

    const pendingTickets = await this.ticketRepo.count({
      where: { status: TicketStatus.ACTIVE },
    });

    const totalTickets = Number(lifetimeTotals?.tickets ?? 0);
    const totalVolume = this.to2Dp(this.parseAmount(lifetimeTotals?.volume));

    const recentResults = (
      await this.resultRepo.find({
        where: { status: ResultStatus.FINALIZED },
        relations: { round: true },
        order: { generatedAt: 'DESC', id: 'DESC' },
        take: 10,
      })
    ).map((result) => this.toResultAdminView(result));

    return {
      controls,
      categoryCards,
      game: {
        poolBalance: this.to2Dp(poolBalance),
        reservedLiquidity: this.to2Dp(reservedLiquidity),
        availableLiquidity: this.to2Dp(
          Decimal.max(poolBalance.minus(reservedLiquidity), 0),
        ),
      },
      totals: {
        totalTickets,
        totalVolume,
        currentOpenRounds: categoryCards.filter(
          (card) => card.round?.status === RoundStatus.OPEN,
        ).length,
      },
      settlement: {
        pendingRounds: pendingSettlementRounds,
        pendingTickets,
      },
      recentResults,
      generatedAt: now.toISOString(),
    };
  }

  async getAdminRounds(query: {
    category?: Category;
    status?: RoundStatus;
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    const safeLimit =
      Number.isInteger(query.limit) && query.limit! > 0
        ? Math.min(query.limit!, 200)
        : 20;
    const safeOffset =
      Number.isInteger(query.offset) && query.offset! >= 0
        ? query.offset!
        : 0;

    const builder = this.roundRepo.createQueryBuilder('round');

    if (query.category) {
      builder.andWhere('round.category = :category', {
        category: query.category,
      });
    }

    if (query.status) {
      builder.andWhere('round.status = :status', { status: query.status });
    }

    if (query.q?.trim()) {
      builder.andWhere('round.roundNumber ILIKE :q', {
        q: `%${query.q.trim()}%`,
      });
    }

    builder
      .orderBy('round.id', 'DESC')
      .addOrderBy('round.drawAt', 'DESC')
      .offset(safeOffset)
      .take(safeLimit);

    const [rounds, total] = await builder.getManyAndCount();

    const items: AdminRoundSummary[] = [];

    for (const round of rounds) {
      items.push(await this.roundAdminView(round));
    }

    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  async getAdminRoundDetail(roundId: number) {
    const round = await this.roundRepo.findOne({
      where: { id: roundId },
      relations: { result: true },
    });

    if (!round) {
      throw new NotFoundException('ROUND_NOT_FOUND');
    }

    const tickets = await this.ticketRepo.find({
      where: { roundId: round.id },
      order: { id: 'ASC' },
      take: 200,
    });

    return {
      round: await this.roundAdminView(round),
      tickets: tickets.map((ticket) => this.toTicketView(ticket)),
    };
  }

  async getAdminTickets(query: {
    category?: Category;
    roundId?: number;
    roundNumber?: string;
    status?: TicketStatus;
    outcome?: SettlementOutcome;
    userId?: string;
    ticketId?: number;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const safeLimit =
      Number.isInteger(query.limit) && query.limit! > 0
        ? Math.min(query.limit!, 200)
        : 50;
    const safeOffset =
      Number.isInteger(query.offset) && query.offset! >= 0
        ? query.offset!
        : 0;

    const builder = this.ticketRepo.createQueryBuilder('ticket');
    builder.leftJoinAndSelect('ticket.settlement', 'settlement');

    if (query.category) {
      builder.andWhere('ticket.category = :category', {
        category: query.category,
      });
    }

    if (Number.isInteger(query.roundId) && query.roundId! > 0) {
      builder.andWhere('ticket.roundId = :roundId', {
        roundId: query.roundId,
      });
    }

    if (query.roundNumber?.trim()) {
      builder.andWhere('ticket.roundNumber = :roundNumber', {
        roundNumber: query.roundNumber.trim(),
      });
    }

    if (query.status) {
      builder.andWhere('ticket.status = :status', { status: query.status });
    }

    if (query.outcome) {
      builder.andWhere('settlement.outcome = :outcome', {
        outcome: query.outcome,
      });
    }

    if (query.userId?.trim()) {
      builder.andWhere('ticket.userId = :userId', {
        userId: query.userId.trim(),
      });
    }

    if (Number.isInteger(query.ticketId) && query.ticketId! > 0) {
      builder.andWhere('ticket.id = :ticketId', { ticketId: query.ticketId });
    }

    if (query.from?.trim()) {
      const fromDate = new Date(query.from);
      if (!Number.isNaN(fromDate.getTime())) {
        builder.andWhere('ticket.createdAt >= :fromDate', { fromDate });
      }
    }

    if (query.to?.trim()) {
      const toDate = new Date(query.to);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        builder.andWhere('ticket.createdAt <= :toDate', { toDate });
      }
    }

    builder
      .orderBy('ticket.id', 'DESC')
      .offset(safeOffset)
      .take(safeLimit);

    const [tickets, total] = await builder.getManyAndCount();

    const items = tickets.map((ticket) => ({
      ...this.toTicketView(ticket),
      settlement: ticket.settlement
        ? {
            outcome: ticket.settlement.outcome,
            payoutAmount: Number(ticket.settlement.payoutAmount ?? 0),
            status: ticket.settlement.status,
            settledAt: ticket.settlement.settledAt?.toISOString() ?? null,
          }
        : null,
    }));

    return { items, total, limit: safeLimit, offset: safeOffset };
  }

  async getAdminResults(query: { limit?: number; offset?: number }) {
    const safeLimit =
      Number.isInteger(query.limit) && query.limit! > 0
        ? Math.min(query.limit!, 200)
        : 20;
    const safeOffset =
      Number.isInteger(query.offset) && query.offset! >= 0
        ? query.offset!
        : 0;

    const [results, total] = await this.resultRepo.findAndCount({
      relations: { round: true },
      order: { generatedAt: 'DESC', id: 'DESC' },
      take: safeLimit,
      skip: safeOffset,
    });

    return {
      items: results.map((result) => this.toResultAdminView(result)),
      total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async getAdminSettings() {
    const controls = await this.getLottoRuntimeControls();

    const poolBalance = this.parseLiquidityPoolBalanceWithFallback(
      await this.getSettingValue(PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY),
    );
    const reservedLiquidity =
      await this.getReservedLiquidityForTicketPlacement(this.roundRepo.manager);

    return {
      game: {
        paused: controls.paused,
        resultMode: controls.resultMode,
        winStrategy: controls.winStrategy,
      },
      categories: ALL_LOTTO_CATEGORIES.map((category) => ({
        category,
        enabled: true,
        locked: true,
        durationSeconds: CATEGORY_DURATION_SECONDS[category],
      })),
      rules: [
        { key: 'minTicketAmount', value: 1.0, unit: 'TDX', locked: true },
        {
          key: 'maxTicketAmount',
          value: 100000.0,
          unit: 'TDX',
          locked: true,
        },
        { key: 'minSelections', value: 1, locked: true },
        { key: 'maxSelections', value: 15, locked: true },
        { key: 'cutoffSeconds', value: 10, unit: 'sec', locked: true },
        { key: 'decimalPlaces', value: 2, locked: true },
        {
          key: 'deductionPercent',
          value: 3,
          breakdown: { referral: 2, admin: 1, net: 97 },
          locked: true,
        },
      ],
      resultModes: Array.from(SUPPORTED_LOTTO_RESULT_MODES),
      winStrategies: [...WIN_STRATEGY_VALUES],
      liquidity: {
        poolBalance: this.to2Dp(poolBalance),
        reservedLiquidity: this.to2Dp(reservedLiquidity),
        availableLiquidity: this.to2Dp(
          Decimal.max(poolBalance.minus(reservedLiquidity), 0),
        ),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async setGamePaused(
    paused: boolean,
    context: AdminActionContext,
  ): Promise<{ paused: boolean }> {
    const previous = await this.getSettingValue(LOTTO_PAUSED_SETTING_KEY);

    await this.upsertSetting(
      LOTTO_PAUSED_SETTING_KEY,
      paused ? 'true' : 'false',
      'boolean',
    );

    await this.writeAuditLog({
      adminId: context.adminId,
      action: paused ? 'PAUSE' : 'RESUME',
      targetType: 'lotto_game',
      targetId: 'game',
      oldValue: {
        paused: this.parseBooleanSetting(previous ?? null),
      },
      newValue: { paused },
      metadata: { paused },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { paused };
  }

  async setResultMode(
    resultMode: string,
    context: AdminActionContext,
  ): Promise<{ resultMode: string }> {
    const normalized = String(resultMode ?? '').trim().toUpperCase();

    if (!SUPPORTED_LOTTO_RESULT_MODES.has(normalized)) {
      throw new BadRequestException('INVALID_RESULT_MODE');
    }

    const previous = await this.getSettingValue(LOTTO_RESULT_MODE_SETTING_KEY);

    await this.upsertSetting(LOTTO_RESULT_MODE_SETTING_KEY, normalized, 'string');

    await this.writeAuditLog({
      adminId: context.adminId,
      action: 'SETTING_CHANGE',
      targetType: 'lotto_settings',
      targetId: 'resultMode',
      oldValue: { resultMode: previous ?? null },
      newValue: { resultMode: normalized },
      metadata: { setting: 'LOTTO_RESULT_MODE', resultMode: normalized },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { resultMode: normalized };
  }

  /**
   * Sets the win strategy applied to SERVER-RANDOM draws (audited).
   *
   * RANDOM → uniform random draw (no steering, default).
   * HIGH   → the symbol with the highest win potential wins.
   * MEDIUM → the symbol whose win potential is closest to the min/max mid-point.
   * LOW    → the symbol with the lowest win potential wins.
   */
  async setWinStrategy(
    winStrategy: string,
    context: AdminActionContext,
  ): Promise<{ winStrategy: WinStrategy }> {
    const normalized = String(winStrategy ?? '').trim().toUpperCase();

    if (!isWinStrategy(normalized)) {
      throw new BadRequestException('INVALID_WIN_STRATEGY');
    }

    const previous = await this.getSettingValue(LOTTO_WIN_STRATEGY_SETTING_KEY);

    await this.upsertSetting(
      LOTTO_WIN_STRATEGY_SETTING_KEY,
      normalized,
      'string',
    );

    await this.writeAuditLog({
      adminId: context.adminId,
      action: 'SETTING_CHANGE',
      targetType: 'lotto_settings',
      targetId: 'winStrategy',
      oldValue: { winStrategy: normalizeWinStrategy(previous ?? null) },
      newValue: { winStrategy: normalized },
      metadata: { setting: LOTTO_WIN_STRATEGY_SETTING_KEY, winStrategy: normalized },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { winStrategy: normalized };
  }

  async adjustLiquidity(
    direction: 'ADD' | 'REMOVE',
    amount: number,
    context: AdminActionContext,
    reason?: string,
  ): Promise<{ poolBalance: number; reservedLiquidity: number }> {
    const parsedAmount = this.parseAmount(amount);

    if (
      parsedAmount.lte(0) ||
      parsedAmount.toDecimalPlaces(2).lt(parsedAmount)
    ) {
      throw new BadRequestException('INVALID_LIQUIDITY_AMOUNT');
    }

    const previous = this.parseLiquidityPoolBalanceWithFallback(
      await this.getSettingValue(PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY),
    );
    const reservedLiquidity =
      await this.getReservedLiquidityForTicketPlacement(this.roundRepo.manager);

    let nextBalance: Decimal;

    if (direction === 'ADD') {
      nextBalance = previous.plus(parsedAmount);
    } else {
      nextBalance = previous.minus(parsedAmount);
      if (nextBalance.lt(reservedLiquidity)) {
        throw new ConflictException('INSUFFICIENT_REMOVABLE_LIQUIDITY');
      }
      if (nextBalance.lt(0)) {
        throw new ConflictException('INSUFFICIENT_AVAILABLE_LIQUIDITY');
      }
    }

    await this.upsertSetting(
      PULSE_LIQUIDITY_POOL_BALANCE_SETTING_KEY,
      nextBalance.toFixed(18),
      'number',
    );

    await this.writeAuditLog({
      adminId: context.adminId,
      action: direction === 'ADD' ? 'ADD_LIQUIDITY' : 'REMOVE_LIQUIDITY',
      targetType: 'lotto_liquidity',
      targetId: 'pool',
      oldValue: { poolBalance: this.to2Dp(previous) },
      newValue: { poolBalance: this.to2Dp(nextBalance) },
      metadata: {
        direction,
        amount: this.to2Dp(parsedAmount),
        reservedLiquidity: this.to2Dp(reservedLiquidity),
        reason: reason?.trim() || undefined,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      poolBalance: this.to2Dp(nextBalance),
      reservedLiquidity: this.to2Dp(reservedLiquidity),
    };
  }

  private async roundAdminView(round: LottoRound): Promise<AdminRoundSummary> {
    const reservedExposure = await this.ticketRepo
      .createQueryBuilder('ticket')
      .select(
        "COALESCE(SUM(CASE WHEN ticket.reservationStatus = 'RESERVED' THEN ticket.reservedAmount ELSE 0 END), 0)",
        'reservedExposure',
      )
      .where('ticket.roundId = :roundId', { roundId: round.id })
      .getRawOne<{ reservedExposure?: string | number }>();

    // An admin result locked in advance (source=ADMIN, not finalized yet) must
    // be visible to the operator so they can verify what will be drawn.
    const lockedResult = round.resultId
      ? null
      : await this.findLockedAdminResult(round.id);

    return {
      id: round.id,
      roundNumber: round.roundNumber,
      category: round.category,
      status: round.status,
      startAt: round.startAt?.toISOString() ?? null,
      cutoffAt: round.cutoffAt?.toISOString() ?? null,
      drawAt: round.drawAt?.toISOString() ?? null,
      result: this.normalizeResultValue(round.result?.result),
      resultSource: round.result?.source ?? null,
      resultGeneratedAt: round.resultGeneratedAt?.toISOString() ?? null,
      lockedResult: lockedResult?.result ?? null,
      lockedResultSource: lockedResult ? 'ADMIN' : null,
      lockedAt: lockedResult?.generatedAt?.toISOString() ?? null,
      settledAt: round.settledAt?.toISOString() ?? null,
      refundedAt: round.refundedAt?.toISOString() ?? null,
      failedAt: round.failedAt?.toISOString() ?? null,
      errorMessage: round.errorMessage,
      totalTickets: round.totalTickets,
      totalAmount: this.to2Dp(this.parseAmount(round.totalAmount)),
      reservedExposure: Number(reservedExposure?.reservedExposure ?? 0),
      remainingSeconds: this.computeRoundRemainingSeconds(round.drawAt, new Date()),
    };
  }

  private computeRoundRemainingSeconds(
    drawAt: Date | null,
    now: Date,
  ): number {
    if (!drawAt) {
      return 0;
    }
    return Math.max(0, Math.floor((drawAt.getTime() - now.getTime()) / 1000));
  }

  private async getSettingValue(key: string): Promise<string | null> {
    const setting = await this.adminSettingRepo.findOne({
      where: { key },
      select: { value: true },
    });
    return setting?.value ?? null;
  }

  private async upsertSetting(
    key: string,
    value: string,
    valueType: 'string' | 'number' | 'boolean' | 'json',
  ): Promise<void> {
    const existing = await this.adminSettingRepo.findOne({
      where: { key },
    });

    if (existing) {
      existing.value = value;
      existing.valueType = valueType;
      await this.adminSettingRepo.save(existing);
      return;
    }

    const setting = this.adminSettingRepo.create({
      key,
      value,
      valueType,
      description: null,
      editable: true,
    });
    await this.adminSettingRepo.save(setting);
  }

  private async writeAuditLog(entry: AdminAuditEntry): Promise<void> {
    const log = this.adminAuditLogRepo.create({
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId:
        entry.targetId === null || entry.targetId === undefined
          ? undefined
          : String(entry.targetId),
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      metadata: entry.metadata ?? {},
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });

    await this.adminAuditLogRepo.save(log);
  }

  private toResultAdminView(result: LottoResult) {
    const settlementStatus =
      result.round?.status === RoundStatus.SETTLED
        ? 'SETTLED'
        : result.round?.status === RoundStatus.RESULTED
          ? 'PENDING_SETTLEMENT'
          : result.round?.status ?? null;

    return {
      id: result.id,
      roundId: result.roundId,
      roundNumber: result.round?.roundNumber ?? null,
      category: result.round?.category ?? null,
      result: this.normalizeResultValue(result.result),
      resultSource: result.source,
      // GENERATED = admin result locked in advance, not yet applied.
      resultStatus: result.status,
      adminId: result.adminId ?? null,
      generatedAt: result.generatedAt?.toISOString() ?? null,
      finalizedAt: result.finalizedAt?.toISOString() ?? null,
      drawAt: result.round?.drawAt?.toISOString() ?? null,
      roundStatus: result.round?.status ?? null,
      settlementStatus,
    };
  }
}
