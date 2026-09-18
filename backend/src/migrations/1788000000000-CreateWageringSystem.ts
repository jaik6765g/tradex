import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Deposit Wagering Requirement System.
 *
 * - wagering_settings ........ singleton global configuration (PK fixed to 1,
 *                              DB-enforced single row), incl. activation_timestamp
 *                              so deposits credited before wagering was enabled
 *                              never create obligations.
 * - wagering_user_overrides .. per-user multiplier override (mandatory reason,
 *                              admin attribution, prospective application).
 * - wagering_obligations ..... durable per-deposit obligation with multiplier +
 *                              conversion-rate snapshots; UNIQUE(depositId).
 * - wagering_events .......... settled wagering volume allocation legs with
 *                              idempotency via UNIQUE(sourceType, sourceId, legIndex).
 * - wagering_notifications ... user-notification outbox.
 *
 * Wagering tables never hold balances and never alter ledger entries — the
 * existing balances + ledger_entries remain the only financial source of truth.
 *
 * The migration is fully idempotent (IF NOT EXISTS everywhere, settings seeded
 * with ON CONFLICT DO NOTHING) and touches no existing table.
 */
export class CreateWageringSystem1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Global settings — singleton row enforced by fixed PK = 1.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wagering_settings" (
        "singletonKey" integer NOT NULL PRIMARY KEY CHECK ("singletonKey" = 1),
        "wageringEnabled" boolean NOT NULL DEFAULT false,
        "defaultMultiplier" integer NOT NULL DEFAULT 2,
        "allowedMultipliers" integer[] NOT NULL DEFAULT '{1,2,3,5,10}',
        "eligibleActivity" varchar(10) NOT NULL DEFAULT 'BOTH'
          CHECK ("eligibleActivity" IN ('LOTTO', 'TRADE', 'BOTH')),
        "withdrawalEnforcement" boolean NOT NULL DEFAULT false,
        "notifyUsers" boolean NOT NULL DEFAULT true,
        "expiryDays" integer NOT NULL DEFAULT 0,
        "reconciliationMaxAgeDays" integer NOT NULL DEFAULT 30,
        "activationTimestamp" timestamptz,
        "policyVersion" integer NOT NULL DEFAULT 1,
        "updatedBy" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_wagering_settings_default_in_allowlist"
          CHECK ("defaultMultiplier" = ANY ("allowedMultipliers"))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "wagering_settings" (
        "singletonKey", "wageringEnabled", "defaultMultiplier",
        "allowedMultipliers", "eligibleActivity", "withdrawalEnforcement",
        "notifyUsers", "expiryDays", "reconciliationMaxAgeDays", "policyVersion"
      )
      VALUES (1, false, 2, '{1,2,3,5,10}', 'BOTH', false, true, 0, 30, 1)
      ON CONFLICT ("singletonKey") DO NOTHING
    `);

    // 2. User-specific multiplier overrides (config — never an obligation).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wagering_user_overrides" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "multiplier" integer NOT NULL,
        "previousValue" integer,
        "reason" text NOT NULL CHECK (length(btrim("reason")) > 0),
        "adminId" uuid NOT NULL,
        "appliedFrom" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wagering_user_overrides_user" UNIQUE ("userId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_overrides_admin"
      ON "wagering_user_overrides" ("adminId")
    `);

    // 3. Durable per-deposit obligations with creation-time snapshots.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wagering_obligations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "depositId" uuid NOT NULL,
        "ledgerEntryId" uuid NOT NULL,
        "sourceUsdtAmount" numeric(36,18) NOT NULL,
        "sourceTdxAmount" numeric(36,18) NOT NULL,
        "conversionRate" numeric(36,18) NOT NULL,
        "depositAmountTdx" numeric(36,18) NOT NULL,
        "multiplier" integer NOT NULL,
        "requiredAmount" numeric(36,18) NOT NULL,
        "completedAmount" numeric(36,18) NOT NULL DEFAULT 0,
        "status" varchar(12) NOT NULL DEFAULT 'ACTIVE'
          CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
        "policyVersion" integer NOT NULL,
        "eligibleActivity" varchar(10) NOT NULL
          CHECK ("eligibleActivity" IN ('LOTTO', 'TRADE', 'BOTH')),
        "expiresAt" timestamptz,
        "cancelledReason" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "completedAt" timestamptz,
        CONSTRAINT "UQ_wagering_obligations_deposit" UNIQUE ("depositId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_obligations_user_status"
      ON "wagering_obligations" ("userId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_obligations_active"
      ON "wagering_obligations" ("status") WHERE "status" = 'ACTIVE'
    `);

    // 4. Settled wagering volume legs — exactly-once accounting.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wagering_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "activityType" varchar(10) NOT NULL
          CHECK ("activityType" IN ('LOTTO', 'TRADE')),
        "sourceType" varchar(30) NOT NULL,
        "sourceId" varchar(64) NOT NULL,
        "legIndex" integer NOT NULL DEFAULT 0,
        "ledgerType" varchar(30) NOT NULL,
        "obligationId" uuid,
        "wageredAmount" numeric(36,18) NOT NULL,
        "allocatedAmount" numeric(36,18) NOT NULL DEFAULT 0,
        "status" varchar(10) NOT NULL DEFAULT 'COUNTED'
          CHECK ("status" IN ('COUNTED', 'REJECTED')),
        "rejectReason" text,
        "policyVersion" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wagering_events_leg"
          UNIQUE ("sourceType", "sourceId", "legIndex"),
        CONSTRAINT "UQ_wagering_events_source_obligation"
          UNIQUE ("sourceType", "sourceId", "obligationId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_events_source"
      ON "wagering_events" ("sourceType", "sourceId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_events_obligation"
      ON "wagering_events" ("obligationId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_events_user"
      ON "wagering_events" ("userId", "createdAt")
    `);

    // 5. User-notification outbox (no other notification infra exists).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wagering_notifications" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "kind" varchar(30) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wagering_notifications_user"
      ON "wagering_notifications" ("userId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SAFETY GUARD: refuse to roll back while live wagering data exists.
    // Dropping populated obligations/events would silently erase outstanding
    // wagering requirements and degrade withdrawal enforcement to a no-op.
    // Only a genuinely empty deployment may be rolled back. No CASCADE.
    const obligationCount = await this.countRows(queryRunner, 'wagering_obligations');
    const eventCount = await this.countRows(queryRunner, 'wagering_events');
    if (obligationCount > 0 || eventCount > 0) {
      throw new Error(
        `Wagering migration rollback refused: wagering_obligations has ${obligationCount} row(s) and wagering_events has ${eventCount} row(s). ` +
          'Live wagering obligations/events exist — a rollback would irreversibly erase outstanding wagering requirements and disable withdrawal enforcement. ' +
          'Cancel or complete the obligations first, or archive the tables manually if you truly intend to lose this data.',
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_notifications_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "wagering_notifications"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wagering_events_user"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_events_obligation"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_events_source"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "wagering_events"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_obligations_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_obligations_user_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "wagering_obligations"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wagering_overrides_admin"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "wagering_user_overrides"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "wagering_settings"`);
  }

  /**
   * Counts rows of a table that may not exist yet (partial-failure recovery).
   * Missing table → 0 (safe to proceed with the drop).
   */
  private async countRows(
    queryRunner: QueryRunner,
    tableName: string,
  ): Promise<number> {
    const exists = await queryRunner.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1`,
      [tableName],
    );
    if (!Array.isArray(exists) || exists.length === 0) return 0;
    const result = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "${tableName}"`);
    return Array.isArray(result) && result.length > 0
      ? Number(result[0]?.count ?? 0)
      : 0;
  }
}