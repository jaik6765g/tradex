import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns lotto_tickets schema with current entity/service contract:
 * - category / roundNumber snapshot columns
 * - maxPayoutLiability / reservedAmount reservation columns
 * - reservationStatus enum state
 * - idempotencyKey + partial unique index
 */
export class AlignLottoTicketEntityContract1776000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'lotto_tickets_reservationstatus_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."lotto_tickets_reservationstatus_enum" AS ENUM(
            'NONE',
            'RESERVED',
            'RELEASED',
            'CONSUMED'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "category" "public"."lotto_rounds_category_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "roundNumber" character varying(50)
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "maxPayoutLiability" numeric(18,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "reservedAmount" numeric(18,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "reservationStatus" "public"."lotto_tickets_reservationstatus_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ADD COLUMN IF NOT EXISTS "idempotencyKey" character varying(128)
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets" t
      SET "category" = r."category"
      FROM "lotto_rounds" r
      WHERE r."id" = t."roundId"
        AND t."category" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets" t
      SET "roundNumber" = r."roundNumber"
      FROM "lotto_rounds" r
      WHERE r."id" = t."roundId"
        AND (t."roundNumber" IS NULL OR btrim(t."roundNumber") = '')
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets"
      SET "category" = 'THIRTY_SEC'
      WHERE "category" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets"
      SET "roundNumber" = CONCAT('ROUND-', "roundId"::text)
      WHERE "roundNumber" IS NULL OR btrim("roundNumber") = ''
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets"
      SET "maxPayoutLiability" = ROUND(
        (COALESCE("netAmount", 0)::numeric * COALESCE("multiplier", 0)::numeric),
        2
      )
      WHERE "maxPayoutLiability" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets"
      SET "reservedAmount" = CASE
        WHEN "status" IN ('SETTLED', 'REFUNDED', 'CANCELLED') THEN 0
        ELSE COALESCE("maxPayoutLiability", 0)
      END
      WHERE "reservedAmount" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "lotto_tickets"
      SET "reservationStatus" = CASE
        WHEN "status" = 'SETTLED' AND COALESCE("winAmount", 0) > 0
          THEN 'CONSUMED'::"public"."lotto_tickets_reservationstatus_enum"
        WHEN "status" IN ('SETTLED', 'REFUNDED', 'CANCELLED')
          THEN 'RELEASED'::"public"."lotto_tickets_reservationstatus_enum"
        ELSE 'RESERVED'::"public"."lotto_tickets_reservationstatus_enum"
      END
      WHERE "reservationStatus" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "category" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "roundNumber" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "maxPayoutLiability" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "reservedAmount" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "reservedAmount" SET DEFAULT '0'
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "reservationStatus" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "lotto_tickets"
      ALTER COLUMN "reservationStatus" SET DEFAULT 'NONE'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lotto_tickets_user_idempotency_unique"
      ON "lotto_tickets" ("userId", "idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally forward-only migration.
  }
}
