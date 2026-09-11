import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairTargetedSchemaDrift1762000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 1) Wallet uniqueness guard: (address, chainId)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'wallets'
        ) AND NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'IDX_wallets_address_chainId_unique'
        ) THEN
          CREATE UNIQUE INDEX "IDX_wallets_address_chainId_unique"
            ON wallets (address, "chainId");
        END IF;
      END
      $$;
    `);

    // 2) Ledger reference_id compatibility: uuid -> varchar (idempotent)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ledger_entries'
            AND column_name = 'reference_id'
            AND udt_name = 'uuid'
        ) THEN
          ALTER TABLE "ledger_entries"
            ALTER COLUMN "reference_id" TYPE varchar USING "reference_id"::text;
        END IF;
      END
      $$;
    `);

    // 3) Pulse-trade defaults expected by entities
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
            AND column_name = 'id'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "pulse_trades"
            ALTER COLUMN "id" SET DEFAULT uuid_generate_v4();
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
            AND column_name = 'createdAt'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "pulse_trades"
            ALTER COLUMN "createdAt" SET DEFAULT now();
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
            AND column_name = 'updatedAt'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "pulse_trades"
            ALTER COLUMN "updatedAt" SET DEFAULT now();
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trade_snapshots'
            AND column_name = 'id'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "pulse_trade_snapshots"
            ALTER COLUMN "id" SET DEFAULT uuid_generate_v4();
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trade_snapshots'
            AND column_name = 'timestamp'
            AND column_default IS NULL
        ) THEN
          ALTER TABLE "pulse_trade_snapshots"
            ALTER COLUMN "timestamp" SET DEFAULT now();
        END IF;
      END
      $$;
    `);

    // 4) Pulse snapshot FK must be ON DELETE CASCADE
    await queryRunner.query(`
      DO $$
      DECLARE
        fk_definition text;
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trade_snapshots'
        ) AND EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'pulse_trades'
        ) THEN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_pulse_snapshots_trade'
              AND conrelid = 'public.pulse_trade_snapshots'::regclass
          ) THEN
            SELECT pg_get_constraintdef(oid)
              INTO fk_definition
            FROM pg_constraint
            WHERE conname = 'FK_pulse_snapshots_trade'
              AND conrelid = 'public.pulse_trade_snapshots'::regclass
            LIMIT 1;

            IF fk_definition NOT ILIKE '%ON DELETE CASCADE%' THEN
              ALTER TABLE "pulse_trade_snapshots"
                DROP CONSTRAINT "FK_pulse_snapshots_trade";
            END IF;
          END IF;

          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'FK_pulse_snapshots_trade'
              AND conrelid = 'public.pulse_trade_snapshots'::regclass
          ) THEN
            ALTER TABLE "pulse_trade_snapshots"
              ADD CONSTRAINT "FK_pulse_snapshots_trade"
              FOREIGN KEY ("tradeId")
              REFERENCES "pulse_trades"("id")
              ON DELETE CASCADE;
          END IF;
        END IF;
      END
      $$;
    `);

    // 5) tdx_balances parity (table + unique userId index)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tdx_balances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "available" numeric(36,18) NOT NULL DEFAULT '0',
        "locked" numeric(36,18) NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_4c1fc8734a0ad66b560cbeeae1c" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_b13c601b017b74f186369a18ec"
      ON "tdx_balances" ("userId")
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally no-op: this migration is an idempotent drift-repair migration.
  }
}
