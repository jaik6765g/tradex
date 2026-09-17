// backend/src/modules/lotto/services/lotto-win-strategy.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { randomInt } from 'crypto';

import { AdminSetting } from '../../../admin/entities/admin-setting.entity';
import {
  LOTTO_RESULT_SYMBOLS,
  WinPotentialOption,
  WinStrategy,
  buildWinPotentialLadder,
  getHighestWinPotential,
  getLowestWinPotential,
  normalizeWinStrategy,
  selectWinPotentialOption,
} from '../utils/lotto-win-strategy.util';

export const LOTTO_WIN_STRATEGY_SETTING_KEY = 'LOTTO_WIN_STRATEGY';

// Ticket statuses that can still win — terminal tickets are already paid or
// refunded and must never influence the ladder.
const UNSETTLED_TICKET_STATUSES = ['ACTIVE', 'CUTOFF'];

export interface RoundWinPotentialSnapshot {
  roundId: number;
  ladder: WinPotentialOption[];
  highestWinPotential: number;
  lowestWinPotential: number;
}

export interface ServerResultSelection extends RoundWinPotentialSnapshot {
  result: string;
  strategy: WinStrategy;
  // null when the draw was NOT steered (RANDOM, or no stake to steer with).
  picked: WinPotentialOption | null;
}

@Injectable()
export class LottoWinStrategyService {
  private readonly logger = new Logger(LottoWinStrategyService.name);

  constructor(
    @InjectRepository(AdminSetting)
    private readonly adminSettingRepo: Repository<AdminSetting>,
  ) {}

  /** Reads the active win strategy from admin_settings (RANDOM by default). */
  async getWinStrategy(manager?: EntityManager): Promise<WinStrategy> {
    const settingRepo = manager
      ? manager.getRepository(AdminSetting)
      : this.adminSettingRepo;

    const setting = await settingRepo.findOne({
      where: { key: LOTTO_WIN_STRATEGY_SETTING_KEY },
      select: { value: true },
    });

    return normalizeWinStrategy(setting?.value ?? null);
  }

  /**
   * Authoritative per-symbol win-potential ladder for ONE round: the exact
   * payout the house owes if each symbol wins, aggregated in the database.
   *
   * Uses a lateral unnest of the comma separated selectedNumbers column so the
   * whole ladder is produced by a single indexed aggregate — no ticket rows are
   * loaded into memory.
   */
  async getRoundWinPotential(
    manager: EntityManager,
    roundId: number,
  ): Promise<WinPotentialOption[]> {
    const rows: Array<{
      option: string;
      betCount: string | number | null;
      winPotential: string | null;
    }> = await manager.query(
      `
        SELECT upper(btrim(opt)) AS "option",
               COUNT(*)::int AS "betCount",
               COALESCE(SUM(t."netAmount" * t."multiplier"), 0)::text AS "winPotential"
          FROM "lotto_tickets" t
          CROSS JOIN LATERAL unnest(string_to_array(t."selectedNumbers", ',')) AS opt
         WHERE t."roundId" = $1
           AND t."status"::text = ANY($2::text[])
           AND btrim(opt) <> ''
         GROUP BY 1
      `,
      [roundId, UNSETTLED_TICKET_STATUSES],
    );

    return buildWinPotentialLadder(rows);
  }

  async getRoundWinPotentialSnapshot(
    manager: EntityManager,
    roundId: number,
  ): Promise<RoundWinPotentialSnapshot> {
    const ladder = await this.getRoundWinPotential(manager, roundId);

    return {
      roundId,
      ladder,
      highestWinPotential: getHighestWinPotential(ladder),
      lowestWinPotential: getLowestWinPotential(ladder),
    };
  }

  /**
   * Resolves the result of a SERVER draw for one round.
   *
   * - RANDOM (or no stake on any symbol) → uniform random symbol.
   * - HIGH / MEDIUM / LOW → the symbol selected by the strategy ladder.
   */
  async selectServerResult(
    manager: EntityManager,
    roundId: number,
    strategy: WinStrategy,
  ): Promise<ServerResultSelection> {
    const ladder = await this.getRoundWinPotential(manager, roundId);
    const picked = selectWinPotentialOption(strategy, ladder);
    const highestWinPotential = getHighestWinPotential(ladder);
    const lowestWinPotential = getLowestWinPotential(ladder);

    if (strategy !== 'RANDOM' && picked === null) {
      this.logger.log(
        `Round ${roundId}: win strategy ${strategy} had no stake signal — falling back to a random draw`,
      );
    }

    return {
      roundId,
      ladder,
      highestWinPotential,
      lowestWinPotential,
      result: picked?.option ?? this.randomResultSymbol(),
      strategy,
      picked,
    };
  }

  private randomResultSymbol(): string {
    return LOTTO_RESULT_SYMBOLS[randomInt(LOTTO_RESULT_SYMBOLS.length)];
  }
}