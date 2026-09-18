import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the four global Deposit/Withdrawal financial limit settings
 * (Architecture Plan v3 — FINAL GLOBAL LIMITS):
 *
 *   minDepositUsdt          = 10     (USDT)
 *   maxDepositUsdt          = 10000  (USDT per transaction)
 *   minWithdrawalUsdt       = 5      (USDT)
 *   maxWithdrawalUsdt       = 500    (USDT per transaction)
 *
 * INSERT ... ON CONFLICT (key) DO NOTHING makes the seed idempotent and
 * guarantees it never overwrites an administrator-customized value.
 *
 * ROLLBACK POLICY (Architecture Plan v3, correction 4): down() is a
 * deliberate no-op. Administrator-customized settings are production
 * configuration and are NEVER destroyed by a migration rollback. The rows
 * and their current values persist; the backend falls back to built-in
 * defaults only if the rows are absent.
 */
export class SeedDepositWithdrawalLimitSettings1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "admin_settings" ("key", "value", "valueType", "description", "editable")
      VALUES
        ('minDepositUsdt', '10', 'number', 'Minimum deposit per transaction in USDT. Enforced server-side in DepositOrderService (deposit gateway) and DepositService (detection).', true),
        ('maxDepositUsdt', '10000', 'number', 'Maximum deposit per transaction in USDT. Enforced server-side at deposit order creation.', true),
        ('minWithdrawalUsdt', '5', 'number', 'Minimum withdrawal per transaction in USDT. Withdrawals are requested in TDX (100 TDX = 1 USDT); enforcement uses exact Decimal.js conversion. Enforced server-side inside the locked withdrawal transaction.', true),
        ('maxWithdrawalUsdt', '500', 'number', 'Maximum withdrawal per transaction in USDT. Enforced server-side inside the locked withdrawal transaction.', true)
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  /**
   * No-op by design: never delete administrator-customized settings.
   * See the rollback policy in the class comment.
   */
  public async down(): Promise<void> {
    // Intentionally empty — preservation over destruction.
  }
}
