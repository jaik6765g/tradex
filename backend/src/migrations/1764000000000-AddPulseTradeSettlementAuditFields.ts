import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPulseTradeSettlementAuditFields1764000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "settlementRetryCount" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "settlementFailureReason" text
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "lastSettlementAttemptAt" timestamp
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "nextSettlementRetryAt" timestamp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      DROP COLUMN IF EXISTS "nextSettlementRetryAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      DROP COLUMN IF EXISTS "lastSettlementAttemptAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      DROP COLUMN IF EXISTS "settlementFailureReason"
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      DROP COLUMN IF EXISTS "settlementRetryCount"
    `);
  }
}
