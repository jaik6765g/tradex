import { MigrationInterface, QueryRunner } from 'typeorm';

import {
  formatWingoPeriodNumberFromSlot,
  isAuthoritativeWingoPeriodNumber,
  isAuthoritativeWingoPeriodNumberForCategory,
  previousWingoPeriodSlot,
  REFERENCE_BACKED_CATEGORIES,
  resolveWingoPeriodSlot,
} from '../modules/period-sync/wingo-period-number';

/**
 * Rekeys every legacy, locally-generated Lotto period number to the
 * authoritative TPPLAY/WinGo period number — in the DB and therefore everywhere
 * the game reads it (Game History, My History, active period, admin screens).
 *
 * WHY
 * ---
 * THIRTY_SEC has always stored the reference `issueNumber`
 * (e.g. 20260915100050781). ONE_MIN / THREE_MIN / FIVE_MIN were only moved onto
 * the authoritative reference later, so every round and result created before
 * that switch kept a locally-generated 6-digit counter (000006, 000007, …
 * e.g. 002922) while 30S showed 17-digit numbers. Result: the live timer showed
 * 20260915100010503 while Game History for 1M showed 002922.
 *
 * WHAT
 * ----
 * 1. Removes corrupt cross-category rounds: an authoritative-shaped number whose
 *    game digit does not belong to the row's category (a THIRTY_SEC row holding
 *    a WinGo_1M number, e.g. ids created while the multi-game sync was rolled
 *    out). Only rows with no ticket / result / settlement / admin action are
 *    deleted — referenced rows are rekeyed instead of deleted.
 * 2. Rekeys every remaining legacy 6-digit round number to the authoritative
 *    number of the reference period its own `drawAt` (period END) falls into.
 * 3. Copies the rekeyed number onto `lotto_tickets.roundNumber` (denormalised
 *    copy, also backing the exposure index).
 *
 * SLOT CONFLICTS
 * --------------
 * The legacy generator created rounds on a drifting clock (a new round starts
 * right after the previous cutoff, ~52s for 1M), so the legacy era contains
 * MORE rounds than the reference grid has period slots and a strict
 * time-faithful mapping is impossible. Rounds are therefore processed NEWEST
 * FIRST and each one takes the first free slot at-or-before its own period:
 * the newest legacy rows (the ones a player actually sees at the top of Game
 * History) keep their exact authoritative period, and the unavoidable drift
 * accumulates in the oldest rows. A slot is never reused, so
 * UNIQUE(category, "roundNumber") always holds.
 *
 * TIME ZONE
 * ---------
 * `drawAt` is a `timestamp without time zone`; the instants are resolved with
 * the exact same driver semantics the application uses when reading these rows,
 * so the rekey must be executed with the same TZ as the app that wrote them
 * (e.g. TZ=Asia/Kolkata for the current local dataset, TZ=UTC on a UTC host).
 *
 * TEN_MIN has no reference game and keeps its legacy numbering (it is not
 * exposed in the player UI).
 *
 * NOT REVERSIBLE: the previous locally-generated numbers are overwritten in
 * place and no audit copy is kept (the requirement is that only 17-digit
 * authoritative numbers exist anywhere in the database).
 */

/** Safety bound for walking backwards to a free slot (per round). */
const MAX_BACKWARD_STEPS = 10_000;
/** Rows per UPDATE statement — stays well inside the parameter limit. */
const UPDATE_BATCH_SIZE = 500;

interface RoundNumberRow {
  id: number;
  roundNumber: string;
  drawAt: Date;
}

export class RekeyLegacyLottoPeriodNumbers1790000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.removeForeignCategoryRounds(queryRunner);
    await this.rekeyLegacyRoundNumbers(queryRunner);
    await this.syncTicketRoundNumbers(queryRunner);
  }

  public async down(): Promise<void> {
    throw new Error(
      'RekeyLegacyLottoPeriodNumbers1790000000000 is not reversible: the legacy ' +
        'locally-generated period numbers were replaced in place and no audit ' +
        'copy exists. Restore the previous database snapshot instead.',
    );
  }

  /**
   * Deletes authoritative-shaped rounds whose game digit belongs to another
   * category. Such a row can never be reconciled with a reference period, so it
   * is removed — but only when nothing references it.
   */
  private async removeForeignCategoryRounds(
    queryRunner: QueryRunner,
  ): Promise<number> {
    const removed: Array<{ id: number }> = await queryRunner.query(`
      DELETE FROM "lotto_rounds" AS r
      USING (VALUES
        ('THIRTY_SEC', '5'),
        ('ONE_MIN', '1'),
        ('THREE_MIN', '2'),
        ('FIVE_MIN', '3')
      ) AS expected(category, digit)
      WHERE r."category"::text = expected.category
        AND r."roundNumber" ~ '^[0-9]{8}1000[0-9]{5}$'
        AND substring(r."roundNumber" FROM 13 FOR 1) <> expected.digit
        AND NOT EXISTS (SELECT 1 FROM "lotto_tickets" t WHERE t."roundId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "lotto_results" res WHERE res."roundId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "lotto_settlements" s WHERE s."roundId" = r.id)
        AND NOT EXISTS (SELECT 1 FROM "admin_actions" a WHERE a."targetId" = r.id)
      RETURNING r.id
    `);

    return removed.length;
  }

  /**
   * Rewrites every legacy round number of a reference-backed category to the
   * authoritative period number derived from the row's own period END.
   */
  private async rekeyLegacyRoundNumbers(queryRunner: QueryRunner): Promise<void> {
    for (const category of REFERENCE_BACKED_CATEGORIES) {
      const rows: RoundNumberRow[] = await queryRunner.query(
        `SELECT "id", "roundNumber", "drawAt"
           FROM "lotto_rounds"
          WHERE "category" = $1
          ORDER BY "drawAt" DESC, "id" DESC`,
        [category],
      );

      // Slots already taken: every authoritative-shaped number in the table
      // (real synced rounds, plus any foreign-digit row kept because something
      // references it). Rekeyed rows are added as they are assigned, so no two
      // rows of a category can ever end up with the same number.
      const reserved = new Set<string>();
      const legacyRows: RoundNumberRow[] = [];

      for (const row of rows) {
        const current = String(row.roundNumber ?? '');
        if (isAuthoritativeWingoPeriodNumber(current)) {
          reserved.add(current);
        }
        if (!isAuthoritativeWingoPeriodNumberForCategory(category, current)) {
          legacyRows.push(row);
        }
      }

      const updates: Array<{ id: number; roundNumber: string }> = [];

      for (const row of legacyRows) {
        const endTimeMs = new Date(row.drawAt).getTime();
        let slot = resolveWingoPeriodSlot(category, endTimeMs);
        if (!slot) {
          continue;
        }

        let candidate = formatWingoPeriodNumberFromSlot(
          category,
          slot.dayMs,
          slot.sequence,
        );
        let steps = 0;

        while (
          candidate !== null &&
          reserved.has(candidate) &&
          steps < MAX_BACKWARD_STEPS
        ) {
          const previous = previousWingoPeriodSlot(
            category,
            slot.dayMs,
            slot.sequence,
          );
          if (!previous) {
            break;
          }

          slot = previous;
          candidate = formatWingoPeriodNumberFromSlot(
            category,
            slot.dayMs,
            slot.sequence,
          );
          steps += 1;
        }

        if (candidate === null) {
          continue;
        }

        reserved.add(candidate);
        updates.push({ id: row.id, roundNumber: candidate });
      }

      await this.applyRoundNumberUpdates(queryRunner, updates);
    }
  }

  private async applyRoundNumberUpdates(
    queryRunner: QueryRunner,
    updates: Array<{ id: number; roundNumber: string }>,
  ): Promise<void> {
    for (let index = 0; index < updates.length; index += UPDATE_BATCH_SIZE) {
      const batch = updates.slice(index, index + UPDATE_BATCH_SIZE);
      const values = batch
        .map((_, offset) => `($${offset * 2 + 1}::int, $${offset * 2 + 2}::varchar)`)
        .join(', ');
      const parameters = batch.flatMap((update) => [
        update.id,
        update.roundNumber,
      ]);

      await queryRunner.query(
        `UPDATE "lotto_rounds" AS r
            SET "roundNumber" = v.round_number
           FROM (VALUES ${values}) AS v(id, round_number)
          WHERE r."id" = v.id`,
        parameters,
      );
    }
  }

  /**
   * `lotto_tickets.roundNumber` is a denormalised copy of the round's period
   * number (it also backs IDX_lotto_tickets_exposure_period) — keep it in step.
   */
  private async syncTicketRoundNumbers(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "lotto_tickets" AS t
         SET "roundNumber" = r."roundNumber"
        FROM "lotto_rounds" AS r
       WHERE r."id" = t."roundId"
         AND t."roundNumber" <> r."roundNumber"
    `);
  }
}