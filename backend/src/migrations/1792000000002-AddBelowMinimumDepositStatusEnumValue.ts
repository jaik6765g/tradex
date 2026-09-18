import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'BELOW_MINIMUM' to the deposits_status_enum PostgreSQL enum.
 *
 * WHY: the on-chain deposit quarantine path (DepositService.createDeposit)
 * records sub-minimum detected deposits with the reviewable BELOW_MINIMUM
 * status so they are never auto-credited and remain recoverable through the
 * authorized admin CREDIT/REJECT review flow. On environments where
 * deposits.status is a native enum, writing that label fails with
 * SQLSTATE 22P02 (invalid input value for enum) until it is added here.
 *
 * SAFETY / IDEMPOTENCY:
 * - The ALTER runs only when public.deposits_status_enum actually exists, so
 *   environments where deposits.status is a plain VARCHAR(20) column (the
 *   schema created by 1700000000000-CreateDepositsAndBalances) are a
 *   safe no-op — no error, nothing invented.
 * - ADD VALUE IF NOT EXISTS makes a re-run a no-op.
 * - This migration does NOT touch the deposits table, does NOT alter or
 *   convert the deposits.status column type, and does NOT add or remove any
 *   column. It only extends the enum's label set.
 *
 * NOTE ON TRANSACTIONS: PostgreSQL allows ALTER TYPE ... ADD VALUE inside a
 * transaction (PG >= 12), but a value added in a transaction cannot be USED
 * in that same transaction. This migration only adds the label — no
 * statement here references 'BELOW_MINIMUM' — so the default TypeORM
 * migration transaction is safe.
 */
export class AddBelowMinimumDepositStatusEnumValue1792000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typname = 'deposits_status_enum'
        ) THEN
          ALTER TYPE "deposits_status_enum" ADD VALUE IF NOT EXISTS 'BELOW_MINIMUM';
        END IF;
      END
      $$;
    `);
  }

  /**
   * Documented no-op: PostgreSQL does not support removing a value from an
   * enum type (there is no DROP VALUE, and the labels cannot be reordered).
   * An unused enum label is inert, so reverting this migration requires no
   * schema change and no data change; leaving 'BELOW_MINIMUM' in place is
   * safe because no code path writes it after a rollback of the feature.
   */
  public async down(): Promise<void> {
    // Intentionally empty — enum values cannot be safely removed.
  }
}
