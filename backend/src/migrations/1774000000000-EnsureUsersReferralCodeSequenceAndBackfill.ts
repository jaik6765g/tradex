import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensures referral-code issuance is backed by a permanent database sequence
 * and backfills missing referral codes for legacy users.
 *
 * Notes:
 * - Existing non-null referral codes are preserved as-is.
 * - Sequence is synchronized to current max TDX<number> value.
 * - Missing referral codes are assigned deterministically by createdAt/id.
 */
export class EnsureUsersReferralCodeSequenceAndBackfill1774000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'users'
        ) THEN
          CREATE SEQUENCE IF NOT EXISTS "users_referral_code_seq"
            AS bigint
            INCREMENT BY 1
            MINVALUE 1
            START WITH 1
            CACHE 1;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        max_referral_number bigint;
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'users'
        ) THEN
          SELECT COALESCE(
            MAX((SUBSTRING("referralCode" FROM '^TDX([0-9]+)$'))::bigint),
            0
          )
          INTO max_referral_number
          FROM users
          WHERE "referralCode" ~ '^TDX[0-9]+$';

          IF max_referral_number > 0 THEN
            PERFORM setval('"users_referral_code_seq"', max_referral_number, true);
          ELSE
            PERFORM setval('"users_referral_code_seq"', 1, false);
          END IF;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      WITH missing_referral_users AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            ORDER BY "createdAt" ASC, id ASC
          ) AS row_num
        FROM users
        WHERE "referralCode" IS NULL
      ),
      allocated_codes AS (
        SELECT
          id,
          nextval('"users_referral_code_seq"') AS seq_value
        FROM missing_referral_users
        ORDER BY row_num
      )
      UPDATE users AS user_record
      SET "referralCode" = 'TDX' || allocated_codes.seq_value::text
      FROM allocated_codes
      WHERE user_record.id = allocated_codes.id
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      "IDX_users_referralCode_unique"
      ON users ("referralCode")
      WHERE "referralCode" IS NOT NULL
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Forward-only safety migration.
  }
}
