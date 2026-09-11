import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserReferralFields1756120000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================================
    // 1. Add referralCode
    // ============================================================

    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "referralCode" VARCHAR(32)
    `);

    // ============================================================
    // 2. Add referredBy
    // ============================================================

    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS "referredBy" UUID
    `);

    // ============================================================
    // 3. Generate referral codes for existing users
    //
    // Format:
    // TX + 8 hexadecimal characters
    //
    // Example:
    // TXA82F91C3
    //
    // PostgreSQL gen_random_uuid() is used instead of
    // JavaScript Math.random().
    // ============================================================

    const users: Array<{ id: string }> = await queryRunner.query(`
        SELECT id
        FROM users
        WHERE "referralCode" IS NULL
        ORDER BY "createdAt" ASC, id ASC
      `);

    for (const user of users) {
      let referralCode: string;
      let attempts = 0;

      while (true) {
        attempts++;

        if (attempts > 20) {
          throw new Error('Unable to generate a unique referral code');
        }

        const result: Array<{ code: string }> = await queryRunner.query(`
            SELECT
              'TX' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8))
              AS code
          `);

        referralCode = result[0].code;

        const existing: Array<{ id: string }> = await queryRunner.query(
          `
              SELECT id
              FROM users
              WHERE "referralCode" = $1
              LIMIT 1
            `,
          [referralCode],
        );

        if (existing.length === 0) {
          break;
        }
      }

      await queryRunner.query(
        `
          UPDATE users
          SET "referralCode" = $1
          WHERE id = $2
        `,
        [referralCode!, user.id],
      );
    }

    // ============================================================
    // 4. Unique referral-code index
    // ============================================================

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      "IDX_users_referralCode_unique"
      ON users ("referralCode")
      WHERE "referralCode" IS NOT NULL
    `);

    // ============================================================
    // 5. Referral parent relationship
    // ============================================================

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_users_referredBy'
        ) THEN
          ALTER TABLE users
          ADD CONSTRAINT "FK_users_referredBy"
          FOREIGN KEY ("referredBy")
          REFERENCES users(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // ============================================================
    // 6. Index referredBy
    // ============================================================

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
      "IDX_users_referredBy"
      ON users ("referredBy")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS "FK_users_referredBy"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_users_referredBy"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_users_referralCode_unique"
    `);

    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "referredBy"
    `);

    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS "referralCode"
    `);
  }
}
