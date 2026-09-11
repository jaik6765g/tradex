import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPulseTradeClientRequestIdUnique1763000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "clientRequestId" VARCHAR(120)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pulse_trades_user_clientRequestId_unique"
      ON "pulse_trades" ("userId", "clientRequestId")
      WHERE "clientRequestId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_pulse_trades_user_clientRequestId_unique"
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      DROP COLUMN IF EXISTS "clientRequestId"
    `);
  }
}
