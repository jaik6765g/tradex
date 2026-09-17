import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a composite index on lotto_tickets (roundNumber, status, category) to
 * support efficient current-period bet exposure aggregation for the admin
 * monitoring dashboard. The index scopes exposure rebuild queries to a single
 * authoritative period and accepted statuses only.
 */
export class AddLottoTicketsExposureIndex1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lotto_tickets_exposure_period"
      ON "lotto_tickets" ("roundNumber", "status", "category")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_lotto_tickets_exposure_period"
    `);
  }
}
