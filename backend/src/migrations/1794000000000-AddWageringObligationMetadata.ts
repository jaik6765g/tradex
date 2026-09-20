import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ============================================================
 * BONUS CATEGORY WAGERING CONTROL — obligation metadata snapshot
 * ============================================================
 *
 * Additive and production-safe (mirrors the Phase-1 hardening style):
 *   - Adds `wagering_obligations.metadata` (jsonb, default '{}') so the
 *     bonus-distribution wagering control can snapshot, on the obligation
 *     row itself: the exact decimal multiplier (CUSTOM multipliers are not
 *     representable in the integer `multiplier` column), the bonus
 *     category, and the distribution source.
 *   - No existing column is modified. No CASCADE. No data loss.
 *   - Idempotent: IF NOT EXISTS, so re-running is a no-op.
 *
 * Rollback: refuses to run while any obligation carries non-empty metadata
 * (that data would be silently lost); otherwise drops the column.
 */
export class AddWageringObligationMetadata1794000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT to_regclass($1) AS name`,
      ['public.wagering_obligations'],
    );
    if (!exists?.[0]?.name) return;

    const populated = await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM "wagering_obligations"
      WHERE "metadata" IS DISTINCT FROM '{}'::jsonb
    `);
    if (Number(populated?.[0]?.count ?? 0) > 0) {
      throw new Error(
        `Wagering obligation metadata rollback refused: ${populated[0].count} obligation(s) carry non-empty metadata. ` +
          'Dropping the column would erase the exact multiplier/category snapshot of live obligations. ' +
          'Archive the data manually first if you truly intend to lose it.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        DROP COLUMN IF EXISTS "metadata"
    `);
  }
}
