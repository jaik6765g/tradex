import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsurePulseTradeSettlementAuditColumns1767000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "settlementRetryCount" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ALTER COLUMN "settlementRetryCount" SET DEFAULT 0
    `);

    await queryRunner.query(`
      UPDATE "pulse_trades"
      SET "settlementRetryCount" = 0
      WHERE "settlementRetryCount" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ALTER COLUMN "settlementRetryCount" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "settlementFailureReason" text
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "lastSettlementAttemptAt" timestamptz
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
            AND column_name = 'lastSettlementAttemptAt'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE "pulse_trades"
          ALTER COLUMN "lastSettlementAttemptAt" TYPE timestamptz
          USING "lastSettlementAttemptAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "pulse_trades"
      ADD COLUMN IF NOT EXISTS "nextSettlementRetryAt" timestamptz
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
            AND column_name = 'nextSettlementRetryAt'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE "pulse_trades"
          ALTER COLUMN "nextSettlementRetryAt" TYPE timestamptz
          USING "nextSettlementRetryAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: this migration intentionally avoids destructive rollback of settlement audit fields
  }
}
