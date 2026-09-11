import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drift-repair migration for core accounting tables.
 *
 * Goals:
 * - Add missing non-destructive indexes used by deposits/ledger flows.
 * - Ensure ledger enum supports TRADE_DRAW used by current service logic.
 * - Re-assert withdrawal idempotency guard indexes (safe no-op when already present).
 *
 * This migration is intentionally additive/idempotent and avoids destructive changes.
 */
export class ReconcileAccountingSchemaDrift1771000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Deposits query-support indexes (transaction_hash already has a UNIQUE index)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'deposits'
        ) THEN
          CREATE INDEX IF NOT EXISTS "idx_deposits_user_id"
            ON "deposits" ("user_id");

          CREATE INDEX IF NOT EXISTS "idx_deposits_status"
            ON "deposits" ("status");

          CREATE INDEX IF NOT EXISTS "idx_deposits_chain_id"
            ON "deposits" ("chain_id");

          CREATE INDEX IF NOT EXISTS "idx_deposits_detected_at"
            ON "deposits" ("detected_at");

          CREATE INDEX IF NOT EXISTS "idx_deposits_created_at"
            ON "deposits" ("created_at");
        END IF;
      END
      $$;
    `);

    // 2) Baseline ledger indexes expected by accounting reads and reconciliation jobs
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'ledger_entries'
        ) THEN
          CREATE INDEX IF NOT EXISTS "idx_ledger_user_id"
            ON "ledger_entries" ("user_id");

          CREATE INDEX IF NOT EXISTS "idx_ledger_type"
            ON "ledger_entries" ("type");

          CREATE INDEX IF NOT EXISTS "idx_ledger_reference_id"
            ON "ledger_entries" ("reference_id");

          CREATE INDEX IF NOT EXISTS "idx_ledger_created_at"
            ON "ledger_entries" ("created_at");
        END IF;
      END
      $$;
    `);

    // 3) Ledger enum compatibility with current LedgerType usage
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typname = 'ledger_entries_type_enum'
        ) THEN
          ALTER TYPE "ledger_entries_type_enum" ADD VALUE IF NOT EXISTS 'TRADE_DRAW';
        END IF;
      END
      $$;
    `);

    // 4) Re-assert withdrawal accounting idempotency guards for drifted environments
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'ledger_entries'
        ) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_lock_reference_unique"
            ON "ledger_entries" ("reference_id")
            WHERE "reference_type" = 'WITHDRAWAL_LOCK'
              AND "type" = 'WITHDRAWAL_LOCK'
              AND "reference_id" IS NOT NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_release_reference_unique"
            ON "ledger_entries" ("reference_id")
            WHERE "reference_type" = 'WITHDRAWAL_RELEASE'
              AND "type" = 'WITHDRAWAL_RELEASE'
              AND "reference_id" IS NOT NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_withdrawal_final_reference_unique"
            ON "ledger_entries" ("reference_id")
            WHERE "reference_type" = 'WITHDRAWAL'
              AND "type" = 'WITHDRAWAL'
              AND "reference_id" IS NOT NULL;
        END IF;
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: forward-only drift-repair migration
  }
}
