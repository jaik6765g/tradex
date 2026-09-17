import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the wingo_periods table that persists the authoritative WinGo
 * 30-second period state as reported by the TPPLAY reference source
 * (https://draw.ar-lottery01.com/WinGo/WinGo_30S.json).
 *
 * The period number is NEVER generated here — it is always copied from the
 * reference. This table is durability only; the authoritative live value is
 * held in memory by PeriodSyncService.
 */
export class CreateWingoPeriods1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "wingo_period_status_enum" AS ENUM ('OPEN', 'CLOSED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "wingo_sync_status_enum" AS ENUM ('SYNCED', 'SYNC_DEGRADED', 'SYNC_ERROR');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE "wingo_periods" (
        "periodNumber" character varying(30) NOT NULL,
        "gameCode" character varying(30) NOT NULL DEFAULT 'WinGo_30S',
        "startTime" bigint NOT NULL,
        "endTime" bigint NOT NULL,
        "previousPeriodNumber" character varying(30),
        "nextPeriodNumber" character varying(30),
        "status" "wingo_period_status_enum" NOT NULL DEFAULT 'OPEN',
        "syncStatus" "wingo_sync_status_enum" NOT NULL DEFAULT 'SYNCED',
        "lastSyncedAt" bigint,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wingo_periods" PRIMARY KEY ("periodNumber")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_wingo_periods_end_time"
      ON "wingo_periods" ("endTime")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wingo_periods"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "wingo_sync_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "wingo_period_status_enum"`,
    );
  }
}
