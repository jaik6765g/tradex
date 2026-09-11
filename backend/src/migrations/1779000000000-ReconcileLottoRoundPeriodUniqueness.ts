import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciles the lotto_rounds uniqueness contract with the frozen LOTTO-01
 * specification:
 *
 *   UNIQUE(category, periodNumber)
 *
 * Each draw category (30 SEC / 1 MIN / 3 MIN / 5 MIN) runs its own period
 * sequence starting at 000006, so the round number must be unique per
 * category — NOT globally. The legacy schema carried a global UNIQUE index
 * on "roundNumber" (UQ_cecd479733baf7fa8bb5423f978) which made it impossible
 * for two categories to share the same period number.
 */
export class ReconcileLottoRoundPeriodUniqueness1779000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the legacy global unique constraint on roundNumber (if present).
    // TypeORM created it as a table constraint, not a plain index.
    await queryRunner.query(`
      ALTER TABLE "lotto_rounds"
      DROP CONSTRAINT IF EXISTS "UQ_cecd479733baf7fa8bb5423f978"
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_rounds"
      DROP CONSTRAINT IF EXISTS "lotto_rounds_round_number_key"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_cecd479733baf7fa8bb5423f978"
    `);

    // Enforce the spec contract: UNIQUE(category, roundNumber).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lotto_rounds_category_round_number_unique"
      ON "lotto_rounds" ("category", "roundNumber")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_lotto_rounds_category_round_number_unique"
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_rounds"
      ADD CONSTRAINT "UQ_cecd479733baf7fa8bb5423f978"
      UNIQUE ("roundNumber")
    `);
  }
}