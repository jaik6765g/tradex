import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add Bot first-activation direct-qualification columns.
 *
 * Adds the admin-configurable "active direct Bot required" thresholds
 * for each first-activation referral level (L1-L6):
 *
 *   first_referral_level_1_direct_required = 1
 *   first_referral_level_2_direct_required = 2
 *   first_referral_level_3_direct_required = 3
 *   first_referral_level_4_direct_required = 4
 *   first_referral_level_5_direct_required = 5
 *   first_referral_level_6_direct_required = 6
 *
 * Idempotent / safe: uses ADD COLUMN IF NOT EXISTS.
 */
export class AddBotDirectQualificationColumns1775000006000
  implements MigrationInterface
{
  name = 'AddBotDirectQualificationColumns1775000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_1_direct_required" integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_2_direct_required" integer NOT NULL DEFAULT 2
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_3_direct_required" integer NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_4_direct_required" integer NOT NULL DEFAULT 4
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_5_direct_required" integer NOT NULL DEFAULT 5
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      ADD COLUMN IF NOT EXISTS "first_referral_level_6_direct_required" integer NOT NULL DEFAULT 6
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_6_direct_required"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_5_direct_required"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_4_direct_required"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_3_direct_required"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_2_direct_required"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_settings
      DROP COLUMN IF EXISTS "first_referral_level_1_direct_required"
    `);
  }
}