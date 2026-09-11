import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciles legacy LOTTO schema (snake_case + INT refs) with current entity contract
 * (camelCase + UUID refs + enum-backed state columns).
 *
 * Safety model:
 * - Hard-aborts if transactional LOTTO tables contain data.
 * - Preserves admin_pool seed balances across table recreation.
 * - Rebuilds LOTTO/admin-lotto tables to the entity-aligned shape.
 */
export class ReconcileLottoSchemaEntityDrift1772000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 1) Preflight guard: never run destructive LOTTO rebuild if tables have live transactional data.
    await queryRunner.query(`
      DO $$
      DECLARE
        tbl text;
        row_count bigint;
        guarded_tables text[] := ARRAY[
          'lotto_rounds',
          'lotto_tickets',
          'lotto_results',
          'lotto_settlements',
          'referral_bonuses',
          'admin_pool_transactions',
          'admin_actions',
          'system_settings'
        ];
      BEGIN
        FOREACH tbl IN ARRAY guarded_tables LOOP
          IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
            EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl)
              INTO row_count;

            IF row_count > 0 THEN
              RAISE EXCEPTION
                'ReconcileLottoSchemaEntityDrift1772000000000 aborted: table % contains % rows. Manual expand/backfill migration is required before destructive LOTTO schema rebuild.',
                tbl,
                row_count;
            END IF;
          END IF;
        END LOOP;
      END
      $$;
    `);

    // 2) Preserve admin_pool totals (legacy snake_case OR entity camelCase shape)
    await queryRunner.query(`
      CREATE TEMP TABLE IF NOT EXISTS tmp_admin_pool_seed (
        total_balance numeric(18,2) NOT NULL DEFAULT 0,
        locked_balance numeric(18,2) NOT NULL DEFAULT 0,
        available_balance numeric(18,2) NOT NULL DEFAULT 0,
        total_deposited numeric(18,2) NOT NULL DEFAULT 0,
        total_withdrawn numeric(18,2) NOT NULL DEFAULT 0
      ) ON COMMIT DROP
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.admin_pool') IS NOT NULL THEN
          BEGIN
            INSERT INTO tmp_admin_pool_seed (
              total_balance,
              locked_balance,
              available_balance,
              total_deposited,
              total_withdrawn
            )
            SELECT
              COALESCE(total_balance, 0),
              COALESCE(locked_balance, 0),
              COALESCE(available_balance, 0),
              COALESCE(total_deposited, 0),
              COALESCE(total_withdrawn, 0)
            FROM public.admin_pool
            ORDER BY id ASC
            LIMIT 1;
          EXCEPTION WHEN undefined_column THEN
            INSERT INTO tmp_admin_pool_seed (
              total_balance,
              locked_balance,
              available_balance,
              total_deposited,
              total_withdrawn
            )
            SELECT
              COALESCE("totalBalance", 0),
              COALESCE("lockedBalance", 0),
              COALESCE("availableBalance", 0),
              COALESCE("totalDeposited", 0),
              COALESCE("totalWithdrawn", 0)
            FROM public.admin_pool
            ORDER BY id ASC
            LIMIT 1;
          END;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM tmp_admin_pool_seed) THEN
          INSERT INTO tmp_admin_pool_seed DEFAULT VALUES;
        END IF;
      END
      $$;
    `);

    // 3) Drop legacy LOTTO/admin-lotto tables (safe after preflight)
    // Use CASCADE to tolerate unknown legacy FK names and the lotto_rounds<->lotto_results
    // cyclic dependency so this step remains safe when re-run in validation flows.
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_actions" CASCADE`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "admin_pool_transactions" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "system_settings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "referral_bonuses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lotto_settlements" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lotto_tickets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lotto_rounds" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lotto_results" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_pool" CASCADE`);

    // 4) Recreate enum types expected by entities
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_rounds_category_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_rounds_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_tickets_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_results_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_results_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_settlements_outcome_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."lotto_settlements_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."referral_bonuses_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."admin_pool_transactions_type_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."lotto_rounds_category_enum" AS ENUM('THIRTY_SEC', 'ONE_MIN', 'THREE_MIN', 'FIVE_MIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_rounds_status_enum" AS ENUM('OPEN', 'CUTOFF', 'DRAWING', 'RESULTED', 'SETTLED', 'FAILED', 'CANCELLED', 'REFUNDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_tickets_status_enum" AS ENUM('ACTIVE', 'CUTOFF', 'WIN', 'LOSS', 'SETTLED', 'REFUNDED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_results_source_enum" AS ENUM('SERVER', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_results_status_enum" AS ENUM('GENERATED', 'FINALIZED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_settlements_outcome_enum" AS ENUM('PENDING', 'WIN', 'LOSS')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lotto_settlements_status_enum" AS ENUM('PENDING', 'SETTLED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_bonuses_status_enum" AS ENUM('PENDING', 'DISTRIBUTED', 'REVERSED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."admin_pool_transactions_type_enum" AS ENUM('DEPOSIT', 'WITHDRAWAL', 'BONUS', 'LEADERBOARD', 'PROMOTION')`,
    );

    // 5) Recreate entity-aligned tables
    await queryRunner.query(`
      CREATE TABLE "lotto_results" (
        "id" SERIAL NOT NULL,
        "roundId" integer NOT NULL,
        "result" character varying(1) NOT NULL,
        "source" "public"."lotto_results_source_enum" NOT NULL DEFAULT 'SERVER',
        "adminId" uuid,
        "status" "public"."lotto_results_status_enum" NOT NULL DEFAULT 'GENERATED',
        "generatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "finalizedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lotto_results" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_6a5b6473002b68a6ee0aa42025d" UNIQUE ("roundId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lotto_rounds" (
        "id" SERIAL NOT NULL,
        "roundNumber" character varying(50) NOT NULL,
        "category" "public"."lotto_rounds_category_enum" NOT NULL DEFAULT 'THIRTY_SEC',
        "status" "public"."lotto_rounds_status_enum" NOT NULL DEFAULT 'OPEN',
        "startAt" TIMESTAMP NOT NULL DEFAULT now(),
        "cutoffAt" TIMESTAMP NOT NULL,
        "drawAt" TIMESTAMP NOT NULL,
        "resultId" integer,
        "resultGeneratedAt" TIMESTAMP,
        "settledAt" TIMESTAMP,
        "failedAt" TIMESTAMP,
        "refundedAt" TIMESTAMP,
        "errorMessage" text,
        "totalTickets" integer NOT NULL DEFAULT '0',
        "totalAmount" numeric(18,2) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lotto_rounds" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cecd479733baf7fa8bb5423f978" UNIQUE ("roundNumber"),
        CONSTRAINT "UQ_f3c0df57916d706a4402ce57e90" UNIQUE ("resultId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lotto_tickets" (
        "id" SERIAL NOT NULL,
        "ticketNumber" character varying(50) NOT NULL,
        "userId" uuid NOT NULL,
        "roundId" integer NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "deductionAmount" numeric(18,2) NOT NULL,
        "referralAmount" numeric(18,2) NOT NULL,
        "adminAmount" numeric(18,2) NOT NULL,
        "netAmount" numeric(18,2) NOT NULL,
        "selectedNumbers" character varying(50) NOT NULL,
        "selectionCount" integer NOT NULL,
        "multiplier" numeric(10,6) NOT NULL,
        "status" "public"."lotto_tickets_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "winAmount" numeric(18,2),
        "purchaseTxId" uuid,
        "settlementTxId" uuid,
        "refundTxId" uuid,
        "settledAt" TIMESTAMP,
        "refundedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lotto_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_9c429b16cf44eafae836b9f2c00" UNIQUE ("ticketNumber")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "lotto_settlements" (
        "id" SERIAL NOT NULL,
        "ticketId" integer NOT NULL,
        "userId" uuid NOT NULL,
        "roundId" integer NOT NULL,
        "result" character varying(1) NOT NULL,
        "outcome" "public"."lotto_settlements_outcome_enum" NOT NULL DEFAULT 'PENDING',
        "calculatedPayout" numeric(18,2),
        "payoutAmount" numeric(18,2),
        "status" "public"."lotto_settlements_status_enum" NOT NULL DEFAULT 'PENDING',
        "settledAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lotto_settlements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ed07bcd7cff92662c88ca798110" UNIQUE ("ticketId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "referral_bonuses" (
        "id" SERIAL NOT NULL,
        "userId" uuid NOT NULL,
        "referrerId" uuid NOT NULL,
        "ticketId" integer NOT NULL,
        "level" character varying(5) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "percentage" numeric(5,2) NOT NULL,
        "status" "public"."referral_bonuses_status_enum" NOT NULL DEFAULT 'PENDING',
        "transactionId" uuid,
        "distributedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referral_bonuses" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_pool" (
        "id" SERIAL NOT NULL,
        "totalBalance" numeric(18,2) NOT NULL DEFAULT '0',
        "lockedBalance" numeric(18,2) NOT NULL DEFAULT '0',
        "availableBalance" numeric(18,2) NOT NULL DEFAULT '0',
        "totalDeposited" numeric(18,2) NOT NULL DEFAULT '0',
        "totalWithdrawn" numeric(18,2) NOT NULL DEFAULT '0',
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_pool" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_pool_transactions" (
        "id" SERIAL NOT NULL,
        "adminPoolId" integer NOT NULL,
        "type" "public"."admin_pool_transactions_type_enum" NOT NULL DEFAULT 'DEPOSIT',
        "amount" numeric(18,2) NOT NULL,
        "balanceBefore" numeric(18,2) NOT NULL,
        "balanceAfter" numeric(18,2) NOT NULL,
        "description" character varying(255),
        "referenceId" character varying(100),
        "adminId" uuid,
        "userId" uuid,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_pool_transactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admin_actions" (
        "id" SERIAL NOT NULL,
        "adminId" uuid NOT NULL,
        "action" character varying(50) NOT NULL,
        "targetType" character varying(50) NOT NULL,
        "targetId" integer NOT NULL,
        "oldValue" jsonb,
        "newValue" jsonb,
        "ipAddress" character varying(45),
        "userAgent" character varying(255),
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_actions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "system_settings" (
        "id" SERIAL NOT NULL,
        "key" character varying(100) NOT NULL,
        "value" text NOT NULL,
        "type" character varying(50) NOT NULL,
        "description" character varying(255),
        "isEditable" boolean NOT NULL DEFAULT true,
        "updatedBy" uuid,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_system_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_settings_key" UNIQUE ("key")
      )
    `);

    // 6) Restore admin_pool seed row and sequence
    await queryRunner.query(`
      INSERT INTO "admin_pool" (
        "totalBalance",
        "lockedBalance",
        "availableBalance",
        "totalDeposited",
        "totalWithdrawn"
      )
      SELECT
        total_balance,
        locked_balance,
        available_balance,
        total_deposited,
        total_withdrawn
      FROM tmp_admin_pool_seed
      LIMIT 1
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('"admin_pool"', 'id'),
        COALESCE((SELECT MAX(id) FROM "admin_pool"), 1),
        true
      )
    `);

    // 7) Recreate indexes expected by entity metadata
    await queryRunner.query(
      `CREATE INDEX "IDX_13f68cab383a6b0e8f811e79c7" ON "lotto_settlements" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0bf70fc240912483d6ac10406a" ON "lotto_settlements" ("roundId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62798c45c1964f88ac39dc50f7" ON "lotto_settlements" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed07bcd7cff92662c88ca79811" ON "lotto_settlements" ("ticketId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b6a9dcb36bb0fb8bc736ce07a6" ON "referral_bonuses" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2732b686c9323b2a10c892d343" ON "referral_bonuses" ("ticketId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f6aebc082bb49ca7a0cf870d7" ON "referral_bonuses" ("referrerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ed68068a22b77b5b7f6be18c6" ON "referral_bonuses" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c429b16cf44eafae836b9f2c0" ON "lotto_tickets" ("ticketNumber")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a03f2583f14bc22d98c36c694" ON "lotto_tickets" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f943b792ff9e0a0a8b8f83db7f" ON "lotto_tickets" ("userId", "roundId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a5b6473002b68a6ee0aa42025" ON "lotto_results" ("roundId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d412dbb196a8c9c4c7d80d6f3" ON "lotto_rounds" ("drawAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a10439d3d3f392bfd086ea771e" ON "lotto_rounds" ("category", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8d6bfd21855eb21c4779903ad" ON "admin_actions" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_459f140bf33973dc633128742f" ON "admin_actions" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf57d3f4a67dde3771b17f8c7e" ON "admin_actions" ("adminId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1b5bc664526d375c94ce9ad43" ON "system_settings" ("key")`,
    );

    // 8) Recreate FKs expected by entity metadata
    await queryRunner.query(`
      ALTER TABLE "lotto_settlements"
      ADD CONSTRAINT "FK_ed07bcd7cff92662c88ca798110"
      FOREIGN KEY ("ticketId") REFERENCES "lotto_tickets"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_settlements"
      ADD CONSTRAINT "FK_62798c45c1964f88ac39dc50f7e"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_settlements"
      ADD CONSTRAINT "FK_0bf70fc240912483d6ac10406a5"
      FOREIGN KEY ("roundId") REFERENCES "lotto_rounds"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "referral_bonuses"
      ADD CONSTRAINT "FK_5ed68068a22b77b5b7f6be18c6d"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "referral_bonuses"
      ADD CONSTRAINT "FK_9f6aebc082bb49ca7a0cf870d73"
      FOREIGN KEY ("referrerId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "referral_bonuses"
      ADD CONSTRAINT "FK_2732b686c9323b2a10c892d3434"
      FOREIGN KEY ("ticketId") REFERENCES "lotto_tickets"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "referral_bonuses"
      ADD CONSTRAINT "FK_fbd43f5ec91503d0a94053217ba"
      FOREIGN KEY ("transactionId") REFERENCES "ledger_entries"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD CONSTRAINT "FK_ebf58f438999bbc4ede41f44f5a"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD CONSTRAINT "FK_772af3ab2422534bfe8ffdf26b7"
      FOREIGN KEY ("roundId") REFERENCES "lotto_rounds"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD CONSTRAINT "FK_42dc5f561f4421ce8c7cf875da2"
      FOREIGN KEY ("purchaseTxId") REFERENCES "ledger_entries"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD CONSTRAINT "FK_8f26a67b999d46d2970592b2973"
      FOREIGN KEY ("settlementTxId") REFERENCES "ledger_entries"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD CONSTRAINT "FK_f3750df3b327ffd5846236d4ce6"
      FOREIGN KEY ("refundTxId") REFERENCES "ledger_entries"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_results"
      ADD CONSTRAINT "FK_6a5b6473002b68a6ee0aa42025d"
      FOREIGN KEY ("roundId") REFERENCES "lotto_rounds"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_results"
      ADD CONSTRAINT "FK_4ecf5f6374d71884061d3253939"
      FOREIGN KEY ("adminId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_rounds"
      ADD CONSTRAINT "FK_f3c0df57916d706a4402ce57e90"
      FOREIGN KEY ("resultId") REFERENCES "lotto_results"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_actions"
      ADD CONSTRAINT "FK_cf57d3f4a67dde3771b17f8c7e8"
      FOREIGN KEY ("adminId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_actions"
      ADD CONSTRAINT "FK_b807cf9b03e729b3d076a6514d3"
      FOREIGN KEY ("targetId") REFERENCES "lotto_rounds"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_pool_transactions"
      ADD CONSTRAINT "FK_e063f12402956fae05c8391ada8"
      FOREIGN KEY ("adminPoolId") REFERENCES "admin_pool"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_pool_transactions"
      ADD CONSTRAINT "FK_abc0f8b134b5efaeb5b3d390161"
      FOREIGN KEY ("adminId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "admin_pool_transactions"
      ADD CONSTRAINT "FK_f459500a38826eeac750c278e90"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally forward-only: this migration performs guarded legacy->entity schema reconciliation.
  }
}
