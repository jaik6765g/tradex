import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the LOTTO win-strategy setting used by the round-engine draw:
 *
 * - RANDOM ... uniform random symbol (default, no steering)
 * - HIGH ..... the symbol with the highest win potential (total payout
 *              liability = SUM(netAmount * multiplier)) wins
 * - MEDIUM ... the symbol whose win potential is closest to the mid-point of
 *              the [lowest, highest] range wins
 * - LOW ...... the symbol with the lowest win potential wins
 *
 * Defaults to RANDOM so existing deployments keep their exact current draw
 * behaviour until an admin explicitly opts in.
 *
 * The INSERT ... ON CONFLICT (key) DO NOTHING pattern is idempotent and safe on
 * databases that already contain the row.
 */
export class SeedLottoWinStrategySetting1791000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "admin_settings" ("key", "value", "valueType", "description", "editable")
      VALUES
        ('LOTTO_WIN_STRATEGY', 'RANDOM', 'string', 'Win strategy applied to server-side lotto draws: RANDOM (uniform draw, no steering), HIGH (symbol with the highest win potential wins), MEDIUM (win potential closest to the min/max mid-point wins), LOW (symbol with the lowest win potential wins). Win potential = SUM(netAmount * multiplier) of all unsettled tickets that selected the symbol.', true)
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "admin_settings"
      WHERE "key" = 'LOTTO_WIN_STRATEGY'
    `);
  }
}
