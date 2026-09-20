import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ============================================================
 * SOURCE-AWARE WAGERING + WITHDRAWAL IDEMPOTENCY HARDENING
 * ============================================================
 *
 * Additive, production-safe. No CASCADE anywhere. No DELETE of live
 * financial data. Every statement is idempotent (IF NOT EXISTS / guarded
 * DO blocks) so re-running is a no-op.
 *
 * Changes
 * -------
 * 1. wagering_obligations
 *      + sourceType, sourceReference (generic source model)
 *      + depositId becomes NULLABLE (bonus sources have no deposit)
 *      + UNIQUE(sourceType, sourceReference)  — exactly-once per source
 *      + UNIQUE(depositId) WHERE depositId IS NOT NULL (partial)
 *      - old table-level UNIQUE(depositId) constraint
 *
 * 2. wallet_source_allocations (NEW)
 *      FIFO source-attribution layer used ONLY to decide withdrawal
 *      eligibility. Holds no spendable money — balances + ledger remain the
 *      sole financial source of truth.
 *
 * 3. withdrawals
 *      + clientRequestId + UNIQUE(userId, clientRequestId) partial
 *      + UNIQUE(payoutIdempotencyKey) partial AFTER safe duplicate handling
 *      + status index (active-withdrawal counting)
 *
 * 4. wagering_events status index
 *
 * Rollback safety: down() REFUSES to run while live attribution rows,
 * non-deposit obligations, or clientRequestId data exist, because dropping
 * those would silently erase withdrawal-eligibility history / obligations.
 */
export class SourceAwareWageringAndWithdrawalHardening1793000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.upgradeWageringObligations(queryRunner);
    await this.createWalletSourceAllocations(queryRunner);
    await this.upgradeWithdrawals(queryRunner);
    await this.addEventStatusIndex(queryRunner);
  }

  // ------------------------------------------------------------
  // 1. wagering_obligations — generic source model
  // ------------------------------------------------------------
  private async upgradeWageringObligations(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        ADD COLUMN IF NOT EXISTS "sourceType" varchar(30) NOT NULL DEFAULT 'DEPOSIT',
        ADD COLUMN IF NOT EXISTS "sourceReference" uuid
    `);

    // Backfill: every legacy obligation is a deposit obligation, so the
    // source reference is the deposit id. Existing financial history is
    // preserved untouched.
    await queryRunner.query(`
      UPDATE "wagering_obligations"
      SET "sourceReference" = "depositId"
      WHERE "sourceReference" IS NULL
        AND "depositId" IS NOT NULL
    `);

    // Fail closed rather than create an unbounded/ambiguous source anchor.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "wagering_obligations" WHERE "sourceReference" IS NULL
        ) THEN
          RAISE EXCEPTION
            'Cannot harden wagering_obligations: rows exist with no sourceReference and no depositId. Resolve them before running this migration.';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        ALTER COLUMN "sourceReference" SET NOT NULL,
        ALTER COLUMN "depositId" DROP NOT NULL
    `);

    // Replace the deposit-only uniqueness with a source-agnostic anchor.
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        DROP CONSTRAINT IF EXISTS "UQ_wagering_obligations_deposit"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wagering_obligations_source"
        ON "wagering_obligations" ("sourceType", "sourceReference")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wagering_obligations_deposit"
        ON "wagering_obligations" ("depositId")
        WHERE "depositId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_obligations_source_ref"
        ON "wagering_obligations" ("sourceReference")
    `);
  }

  // ------------------------------------------------------------
  // 2. wallet_source_allocations — FIFO withdrawal-eligibility layer
  // ------------------------------------------------------------
  private async createWalletSourceAllocations(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wallet_source_allocations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "sourceType" varchar(30) NOT NULL
          CHECK ("sourceType" IN
            ('DEPOSIT','BONUS','REFERRAL_COMMISSION','SALARY','LEGACY','OTHER')),
        "sourceId" varchar(128) NOT NULL,
        "ledgerEntryId" uuid,
        "wagerable" boolean NOT NULL,
        "originalAmount" numeric(36,18) NOT NULL
          CHECK ("originalAmount" > 0),
        "consumedAmount" numeric(36,18) NOT NULL DEFAULT 0
          CHECK ("consumedAmount" >= 0),
        "reservedAmount" numeric(36,18) NOT NULL DEFAULT 0
          CHECK ("reservedAmount" >= 0),
        "status" varchar(12) NOT NULL DEFAULT 'ACTIVE'
          CHECK ("status" IN ('ACTIVE','EXHAUSTED','VOID')),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_wallet_source_allocations_bounds"
          CHECK ("consumedAmount" + "reservedAmount" <= "originalAmount")
      )
    `);
    // One bucket per credited source — the exactly-once idempotency anchor.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wallet_source_allocations_source"
        ON "wallet_source_allocations" ("sourceId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wallet_source_allocations_user"
        ON "wallet_source_allocations" ("userId")
    `);
    // Deterministic FIFO consumption order.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wallet_source_allocations_fifo"
        ON "wallet_source_allocations" ("userId", "status", "createdAt", "id")
    `);
  }

  // ------------------------------------------------------------
  // 3. withdrawals — clientRequestId + payout key uniqueness
  // ------------------------------------------------------------
  private async upgradeWithdrawals(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "withdrawals"
        ADD COLUMN IF NOT EXISTS "clientRequestId" varchar(120)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_withdrawals_user_clientRequestId_unique"
        ON "withdrawals" ("userId", "clientRequestId")
        WHERE "clientRequestId" IS NOT NULL
    `);

    // payoutIdempotencyKey duplicate handling BEFORE the unique index.
    // No row is deleted and no financial field is destroyed: the earliest
    // withdrawal keeps the key, later duplicates have the original key moved
    // into metadata for audit and the column NULLed so the constraint can be
    // created safely.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          "id",
          "payoutIdempotencyKey",
          ROW_NUMBER() OVER (
            PARTITION BY "payoutIdempotencyKey"
            ORDER BY "payoutAttempted" DESC, "createdAt" ASC, "id" ASC
          ) AS rn
        FROM "withdrawals"
        WHERE "payoutIdempotencyKey" IS NOT NULL
      )
      UPDATE "withdrawals" AS w
      SET
        "metadata" = COALESCE(w."metadata", '{}'::jsonb) ||
          jsonb_build_object(
            'payoutIdempotencyKeyDuplicate',
            jsonb_build_object(
              'originalKey', w."payoutIdempotencyKey",
              'detectedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
              'note', 'duplicate payoutIdempotencyKey detected during hardening migration; earliest row retained the key'
            )
          ),
        "payoutIdempotencyKey" = NULL
      FROM ranked r
      WHERE w."id" = r."id" AND r.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_withdrawals_payoutIdempotencyKey_unique"
        ON "withdrawals" ("payoutIdempotencyKey")
        WHERE "payoutIdempotencyKey" IS NOT NULL
    `);
    // The legacy NON-unique index is now redundant (superseded by the partial
    // unique index). Dropping an index destroys no data and is recreated by
    // down() to restore the previous schema shape.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_withdrawals_payoutIdempotencyKey"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_withdrawals_status"
        ON "withdrawals" ("status")
    `);
  }

  // ------------------------------------------------------------
  // 4. wagering_events — status index for reconciliation scans
  // ------------------------------------------------------------
  private async addEventStatusIndex(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_events_status"
        ON "wagering_events" ("status")
    `);
  }

  // ------------------------------------------------------------
  // ROLLBACK — refuse while live financial/eligibility data exists
  // ------------------------------------------------------------
  public async down(queryRunner: QueryRunner): Promise<void> {
    const allocationCount = await this.countRows(
      queryRunner,
      'wallet_source_allocations',
    );
    if (allocationCount > 0) {
      throw new Error(
        `Source-aware hardening rollback refused: wallet_source_allocations has ${allocationCount} row(s). ` +
          'Dropping it would silently erase the withdrawal-eligibility history of credited funds. ' +
          'Archive the rows manually first if you truly intend to lose this data.',
      );
    }

    const nonDepositObligations = await this.countRows(
      queryRunner,
      'wagering_obligations',
      `"sourceType" <> 'DEPOSIT'`,
    );
    if (nonDepositObligations > 0) {
      throw new Error(
        `Source-aware hardening rollback refused: wagering_obligations has ${nonDepositObligations} non-deposit obligation(s). ` +
          'Reverting sourceReference would destroy live bonus obligations and disable their withdrawal enforcement.',
      );
    }

    const clientRequestCount = await this.countRows(
      queryRunner,
      'withdrawals',
      `"clientRequestId" IS NOT NULL`,
    );
    if (clientRequestCount > 0) {
      throw new Error(
        `Source-aware hardening rollback refused: withdrawals has ${clientRequestCount} row(s) carrying clientRequestId. ` +
          'Dropping the idempotency anchor would allow duplicate withdrawal creation on the next retry.',
      );
    }

    const duplicatePayoutKeyCount = await this.countRows(
      queryRunner,
      'withdrawals',
      `"metadata" ? 'payoutIdempotencyKeyDuplicate'`,
    );
    if (duplicatePayoutKeyCount > 0) {
      throw new Error(
        `Source-aware hardening rollback refused: withdrawals has ${duplicatePayoutKeyCount} row(s) whose duplicate payoutIdempotencyKey was moved to metadata. ` +
          'A rollback would lose the audit trail of that duplicate handling.',
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_events_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_withdrawals_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_withdrawals_payoutIdempotencyKey_unique"`,
    );
    // Restore the legacy non-unique index that the forward migration replaced,
    // so the previous schema shape is fully recreated.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_withdrawals_payoutIdempotencyKey"
        ON "withdrawals" ("payoutIdempotencyKey")
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_withdrawals_user_clientRequestId_unique"`,
    );
    await queryRunner.query(
      `ALTER TABLE "withdrawals" DROP COLUMN IF EXISTS "clientRequestId"`,
    );

    // Drop the attribution layer BEFORE restoring the NOT NULL depositId
    // constraint, so rollback order can never paint us into a corner.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_source_allocations_fifo"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallet_source_allocations_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_wallet_source_allocations_source"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "wallet_source_allocations"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_obligations_source_ref"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_wagering_obligations_deposit"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_wagering_obligations_source"`,
    );

    // Only restore the legacy deposit-only uniqueness when no bonus rows can
    // exist (guarded above), and backfill depositId from sourceReference for
    // legacy deposit rows first so NOT NULL cannot fail.
    await queryRunner.query(`
      UPDATE "wagering_obligations"
      SET "depositId" = "sourceReference"
      WHERE "depositId" IS NULL AND "sourceType" = 'DEPOSIT'
    `);
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        ALTER COLUMN "depositId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        ADD CONSTRAINT "UQ_wagering_obligations_deposit" UNIQUE ("depositId")
    `);
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        DROP COLUMN IF EXISTS "sourceReference"
    `);
    await queryRunner.query(`
      ALTER TABLE "wagering_obligations"
        DROP COLUMN IF EXISTS "sourceType"
    `);
  }

  /**
   * Counts rows for a rollback guard. Returns 0 when the table does not
   * exist yet (fresh deployment that never ran the forward migration).
   */
  private async countRows(
    queryRunner: QueryRunner,
    table: string,
    where?: string,
  ): Promise<number> {
    const exists = await queryRunner.query(
      `SELECT to_regclass($1) AS name`,
      [`public.${table}`],
    );
    if (!exists?.[0]?.name) return 0;
    const rows = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "${table}"${where ? ` WHERE ${where}` : ''}`,
    );
    return Number(rows?.[0]?.count ?? 0);
  }
}

