import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciles withdrawals schema drift for payout/admin list flows:
 * - Ensures payoutWalletAddress column exists (used by approval + admin search).
 * - Ensures payoutIdempotencyKey column shape is aligned.
 * - Ensures payoutIdempotencyKey index exists (entity parity).
 */
export class ReconcileWithdrawalPayoutWalletAndIdempotencyIndex1773000000000 implements MigrationInterface {
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
              AND column_name = 'payoutWalletAddress'
          ) THEN
            ALTER TABLE "withdrawals"
              ADD COLUMN "payoutWalletAddress" VARCHAR(42) NULL;
          END IF;

          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'withdrawals'
              AND column_name = 'payoutIdempotencyKey'
          ) THEN
            ALTER TABLE "withdrawals"
              ALTER COLUMN "payoutIdempotencyKey" TYPE VARCHAR(100);
          END IF;

          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'withdrawals'
              AND column_name = 'payoutIdempotencyKey'
          ) THEN
            CREATE INDEX IF NOT EXISTS "IDX_withdrawals_payoutIdempotencyKey"
              ON "withdrawals" ("payoutIdempotencyKey");
          END IF;
        END IF;
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Forward-only drift reconciliation migration.
  }
}
