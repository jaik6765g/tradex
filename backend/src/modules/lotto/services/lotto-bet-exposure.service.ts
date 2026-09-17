// backend/src/modules/lotto/services/lotto-bet-exposure.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import Decimal from 'decimal.js';
import { LottoTicket, TicketStatus } from '../entities/lotto-ticket.entity';
import { Category, LottoRound, RoundStatus } from '../entities/lotto-round.entity';
import { PeriodSyncService } from '../../period-sync/period-sync.service';
import { LottoWinStrategyService } from './lotto-win-strategy.service';
import {
  WinPotentialOption,
  buildWinPotentialLadder,
  buildWinPotentialTiers,
  selectWinPotentialOption,
} from '../utils/lotto-win-strategy.util';

export interface ExposureOption {
  option: string;
  betCount: number;
  totalStake: number;
  // Payout the house owes if this symbol wins (SUM of netAmount * multiplier
  // over every unsettled ticket that selected it).
  winPotential: number;
  // House profit/loss for this symbol: totalStake - winPotential.
  netExposure: number;
}

export interface ExposureStrategyPick {
  option: string;
  strategy: string;
  winPotential: number;
  betCount: number;
}

export interface ExposureSnapshot {
  periodNumber: string | null;
  category: string;
  startTime: number | null;
  endTime: number | null;
  serverTime: number;
  remainingMs: number;
  status: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  syncStatus: string;
  totalStake: number;
  totalBets: number;
  maxWinPotential: number;
  options: ExposureOption[];
  // Active draw strategy + the number the engine will actually draw for the
  // active round (authoritative — evaluated with the same ladder the draw uses).
  winStrategy: string;
  winTiers: { highest: string[]; medium: string[]; lowest: string[] };
  activeRoundId: number | null;
  activeRoundNumber: string | null;
  strategyPick: ExposureStrategyPick | null;
  updatedAt: number;
}

interface CacheEntry {
  periodNumber: string;
  snapshot: ExposureSnapshot;
  cachedAt: number;
}

const ALL_OPTIONS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

// Accepted = live unsettled plays only (spec section 6).
const EXPOSURE_STATUSES: TicketStatus[] = [TicketStatus.ACTIVE, TicketStatus.CUTOFF];

// Rounds that can still be drawn (the next symbol the engine will resolve).
const DRAWABLE_ROUND_STATUSES: RoundStatus[] = [
  RoundStatus.OPEN,
  RoundStatus.CUTOFF,
  RoundStatus.DRAWING,
];

// Micro-cache TTL: absorbs poll bursts from multiple admin tabs so we never
// hammer the DB every few ms. The DATABASE remains the authoritative source —
// any bet placed is reflected at most TTL later, and a period change always
// forces an immediate rebuild.
const CACHE_TTL_MS = 1500;

const to2Dp = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

@Injectable()
export class LottoBetExposureService implements OnModuleInit {
  private readonly logger = new Logger(LottoBetExposureService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(LottoTicket) private readonly ticketRepo: Repository<LottoTicket>,
    @InjectRepository(LottoRound) private readonly roundRepo: Repository<LottoRound>,
    private readonly periodSyncService: PeriodSyncService,
    private readonly winStrategyService: LottoWinStrategyService,
  ) {}

  onModuleInit(): void { this.logger.log('LottoBetExposureService initialised (DB-backed, TTL ' + CACHE_TTL_MS + 'ms)'); }

  /**
   * Authoritative exposure for the current synced period. Reads are served
   * from a short-TTL micro-cache backed by an indexed DB aggregation scoped
   * to exactly one period — never a full-table scan. Pass forceRefresh=true
   * to bypass the cache (used by tests / explicit admin refresh).
   *
   * The ACTIVE round of the category is the source of truth for what players
   * are betting on: reference-backed rounds carry the synced period number,
   * so scoping tickets by the round (and falling back to the synced period)
   * is correct for every supported category — the period number alone is
   * only guaranteed for THIRTY_SEC.
   *
   * Every snapshot also carries the win-potential view (payout liability per
   * symbol) and, for the active round, the exact symbol the draw engine will
   * resolve — so the operator sees the same numbers the engine uses.
   */
  async getExposure(category: Category = Category.THIRTY_SEC, forceRefresh = false): Promise<ExposureSnapshot> {
    const sync = this.resolveSync(category);
    if (!sync || !sync.periodNumber) {
      return this.attachStrategy(category, this.emptySnapshot(category, sync), null);
    }

    const activeRound = await this.findActiveRound(category);
    const scopeKey = activeRound ? `round:${activeRound.id}` : `period:${sync.periodNumber}`;

    const cached = this.cache.get(category);
    const fresh = !forceRefresh && cached && cached.periodNumber === scopeKey && (Date.now() - cached.cachedAt) < CACHE_TTL_MS;
    if (fresh) return cached.snapshot;

    const snapshot = await this.attachStrategy(
      category,
      await this.aggregate(category, sync, activeRound),
      activeRound,
    );
    this.cache.set(category, { periodNumber: scopeKey, snapshot, cachedAt: Date.now() });
    return snapshot;
  }

  /** Period metadata for the category (reference-backed categories are per-game). */
  private resolveSync(category: Category): ReturnType<PeriodSyncService['getSnapshot']> {
    return this.periodSyncService.hasReferenceForCategory(category)
      ? (this.periodSyncService.getSnapshotForCategory(category) ??
          this.periodSyncService.getSnapshot())
      : this.periodSyncService.getSnapshot();
  }

  /** The round that will be drawn next for this category. */
  private findActiveRound(category: Category): Promise<LottoRound | null> {
    return this.roundRepo.findOne({
      where: { category, status: In(DRAWABLE_ROUND_STATUSES) },
      order: { drawAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Adds the active strategy and the authoritative draw preview:
   *
   * - winTiers  bands are derived from the LIVE per-symbol ladder displayed in
   *             the table (the same numbers the operator sees).
   * - strategyPick is evaluated on the ACTIVE round — the same ladder the draw
   *             engine evaluates at draw time — so it is the exact symbol that
   *             will be drawn unless an admin result is locked.
   */
  private async attachStrategy(
    category: Category,
    snapshot: ExposureSnapshot,
    activeRound: LottoRound | null,
  ): Promise<ExposureSnapshot> {
    const winStrategy = await this.winStrategyService.getWinStrategy();

    let strategyPick: ExposureStrategyPick | null = null;
    let activeRoundId: number | null = activeRound?.id ?? null;
    let activeRoundNumber: string | null = activeRound?.roundNumber ?? null;

    if (activeRound) {
      try {
        const ladder = await this.winStrategyService.getRoundWinPotential(
          this.roundRepo.manager,
          activeRound.id,
        );
        const picked = selectWinPotentialOption(winStrategy, ladder);

        if (picked) {
          strategyPick = {
            option: picked.option,
            strategy: winStrategy,
            winPotential: picked.winPotential,
            betCount: picked.betCount,
          };
        }
      } catch (error) {
        // A preview failure must never break the admin exposure view.
        this.logger.warn(`Strategy preview unavailable: ${(error as Error).message}`);
      }
    }

    const ladder: WinPotentialOption[] = buildWinPotentialLadder(
      snapshot.options.map((option) => ({
        option: option.option,
        betCount: option.betCount,
        winPotential: option.winPotential,
      })),
    );

    return {
      ...snapshot,
      winStrategy,
      winTiers: buildWinPotentialTiers(ladder),
      activeRoundId,
      activeRoundNumber,
      strategyPick,
    };
  }

  private async aggregate(
    category: Category,
    sync: NonNullable<ReturnType<PeriodSyncService['getSnapshot']>>,
    activeRound: LottoRound | null,
  ): Promise<ExposureSnapshot> {
    // Indexed scope: the active round when one exists (covers every supported
    // category),
    // otherwise the accepted unsettled bets of the synced period.
    const tickets = activeRound
      ? await this.ticketRepo.find({
          where: { roundId: activeRound.id, status: In(EXPOSURE_STATUSES) },
          select: {
            id: true,
            amount: true,
            netAmount: true,
            multiplier: true,
            selectedNumbers: true,
          } as any,
        })
      : await this.ticketRepo.find({
          where: { category, roundNumber: sync.periodNumber, status: In(EXPOSURE_STATUSES) },
          select: {
            id: true,
            amount: true,
            netAmount: true,
            multiplier: true,
            selectedNumbers: true,
          } as any,
        });

    const totals = new Map<string, ExposureOption>();
    for (const o of ALL_OPTIONS) {
      totals.set(o, { option: o, betCount: 0, totalStake: 0, winPotential: 0, netExposure: 0 });
    }

    let totalStake = 0;
    for (const t of tickets) {
      const amt = Number(t.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      totalStake = to2Dp(totalStake + amt);

      // Exact payout liability of this ticket if any of its symbols wins —
      // identical to what settleTicketForRound() pays (netAmount * multiplier).
      const liability = new Decimal(t.netAmount ?? 0)
        .mul(new Decimal(t.multiplier ?? 0))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber();
      const safeLiability = Number.isFinite(liability) ? liability : 0;

      for (const num of (t.selectedNumbers ?? '').split(',').map((n) => n.trim()).filter(Boolean)) {
        const opt = totals.get(num);
        if (opt) {
          opt.betCount += 1;
          opt.totalStake = to2Dp(opt.totalStake + amt);
          opt.winPotential = to2Dp(opt.winPotential + safeLiability);
        }
      }
    }

    const options = ALL_OPTIONS.map((o) => {
      const entry = totals.get(o)!;
      return { ...entry, netExposure: to2Dp(entry.totalStake - entry.winPotential) };
    });

    return {
      // The active round's own number is the accurate label for what is being
      // displayed; reference-backed rounds always match the synced period.
      periodNumber: activeRound?.roundNumber ?? sync.periodNumber, category,
      startTime: sync.startTime, endTime: sync.endTime, serverTime: sync.serverTime,
      remainingMs: sync.remainingMs, status: sync.status, syncStatus: sync.syncStatus,
      totalStake: to2Dp(totalStake), totalBets: tickets.length,
      maxWinPotential: options.reduce((max, option) => Math.max(max, option.winPotential), 0),
      options,
      winStrategy: 'RANDOM',
      winTiers: { highest: [], medium: [], lowest: [] },
      activeRoundId: null,
      activeRoundNumber: null,
      strategyPick: null,
      updatedAt: Date.now(),
    };
  }

  private emptySnapshot(category: Category, sync: ReturnType<PeriodSyncService['getSnapshot']>): ExposureSnapshot {
    return {
      periodNumber: sync?.periodNumber ?? null, category,
      startTime: sync?.startTime ?? null, endTime: sync?.endTime ?? null,
      serverTime: sync?.serverTime ?? Date.now(), remainingMs: sync?.remainingMs ?? 0,
      status: sync?.status ?? 'UNKNOWN', syncStatus: sync?.syncStatus ?? 'UNKNOWN',
      totalStake: 0, totalBets: 0, maxWinPotential: 0,
      options: ALL_OPTIONS.map((o) => ({ option: o, betCount: 0, totalStake: 0, winPotential: 0, netExposure: 0 })),
      winStrategy: 'RANDOM',
      winTiers: { highest: [], medium: [], lowest: [] },
      activeRoundId: null,
      activeRoundNumber: null,
      strategyPick: null,
      updatedAt: Date.now(),
    };
  }
}
