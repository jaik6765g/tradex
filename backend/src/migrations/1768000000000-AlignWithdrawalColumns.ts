import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignWithdrawalColumns1768000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'withdrawals'
        ) THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'withdrawals'
              AND column_name = 'approvedAt'
          ) THEN
            ALTER TABLE "withdrawals"
              ADD COLUMN "approvedAt" TIMESTAMPTZ NULL;
          ELSE
            ALTER TABLE "withdrawals"
              ALTER COLUMN "approvedAt" TYPE TIMESTAMPTZ
              USING "approvedAt" AT TIME ZONE 'UTC';
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'withdrawals'
              AND column_name = 'approvedBy'
          ) THEN
            ALTER TABLE "withdrawals"
              ADD COLUMN "approvedBy" UUID NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'withdrawals'
              AND column_name = 'metadata'
          ) THEN
            ALTER TABLE "withdrawals"
              ADD COLUMN "metadata" JSONB NULL DEFAULT '{}'::jsonb;
          ELSE
            ALTER TABLE "withdrawals"
              ALTER COLUMN "metadata" TYPE JSONB USING "metadata"::jsonb,
              ALTER COLUMN "metadata" DROP NOT NULL,
              ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op; safe forward-only drift alignment migration
  }
}
