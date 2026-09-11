import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the admin_settings table with maxWithdrawalsPerUserPerDay so the
 * Admin Settings UI can display and edit it.
 *
 * The withdrawal service falls back to a hardcoded default (3) when the
 * setting row is missing, but without this seed the value is invisible and
 * uneditable through the Admin Panel — it only exists as a constant in
 * withdrawals.service.ts.
 *
 * The INSERT ... ON CONFLICT (key) DO NOTHING pattern makes this migration
 * idempotent and safe to run on databases that already contain the row.
 */
export class SeedWithdrawalPerUserPerDaySetting1777000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "admin_settings" ("key", "value", "valueType", "description", "editable")
      VALUES
        ('maxWithdrawalsPerUserPerDay', '3', 'number', 'Maximum number of withdrawal requests a single user may have COMPLETED per UTC day. Enforced server-side in WithdrawalsService.', true)
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "admin_settings" WHERE "key" = 'maxWithdrawalsPerUserPerDay'
    `);
  }
}
