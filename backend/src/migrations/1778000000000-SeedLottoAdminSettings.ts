import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the authoritative Lotto admin settings into admin_settings so the
 * Lotto Game Manager admin UI has real, editable, backend-persisted values:
 *
 * - LOTTO_PAUSED ......... blocks new ticket purchases (drawn/settlement continue)
 * - LOTTO_RESULT_MODE .... SERVER_RANDOM | ADMIN_RESULT | VERIFIED_RANDOM
 * - PULSE_LIQUIDITY_POOL_BALANCE ... pooled TDX used to reserve + honour wins
 *
 * The INSERT ... ON CONFLICT (key) DO NOTHING pattern is idempotent and safe
 * on databases that already contain the rows.
 */
export class SeedLottoAdminSettings1778000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "admin_settings" ("key", "value", "valueType", "description", "editable")
      VALUES
        ('LOTTO_PAUSED', 'false', 'boolean', 'When true the Lotto game is paused and new ticket purchases are rejected by the backend. Draws and settlements continue for rounds already in flight.', true),
        ('LOTTO_RESULT_MODE', 'SERVER_RANDOM', 'string', 'Active result mode applied to due draws: SERVER_RANDOM (backend draws), ADMIN_RESULT (authorized admin sets the result), VERIFIED_RANDOM (resolved by the backend as SERVER_RANDOM until the verified-random scheme is documented).', true),
        ('PULSE_LIQUIDITY_POOL_BALANCE', '100000', 'number', 'Authoritative LOTTO liquidity pool balance used to reserve and honour winning payouts.', true)
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "admin_settings"
      WHERE "key" IN ('LOTTO_PAUSED', 'LOTTO_RESULT_MODE', 'PULSE_LIQUIDITY_POOL_BALANCE')
    `);
  }
}