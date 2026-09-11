import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One financial event of each kind is permitted for a withdrawal. Historical
 * entries are preserved; this only prevents future concurrent retries from
 * inserting a second lock, release, or final consumption entry.
 */
export class AddWithdrawalAccountingIdempotencyGuards1769000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_lock_reference_unique"
      ON "ledger_entries" ("reference_id")
      WHERE "reference_type" = 'WITHDRAWAL_LOCK'
        AND "type" = 'WITHDRAWAL_LOCK'
        AND "reference_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_release_reference_unique"
      ON "ledger_entries" ("reference_id")
      WHERE "reference_type" = 'WITHDRAWAL_RELEASE'
        AND "type" = 'WITHDRAWAL_RELEASE'
        AND "reference_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_final_reference_unique"
      ON "ledger_entries" ("reference_id")
      WHERE "reference_type" = 'WITHDRAWAL'
        AND "type" = 'WITHDRAWAL'
        AND "reference_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ledger_withdrawal_final_reference_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ledger_withdrawal_release_reference_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ledger_withdrawal_lock_reference_unique"`,
    );
  }
}
