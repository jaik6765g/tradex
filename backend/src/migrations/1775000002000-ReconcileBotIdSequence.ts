import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drift-repair migration for bot_id_seq.
 *
 * Some environments have bot tables migrated but missing sequence,
 * which breaks POST /bot/account when generating Bot IDs.
 */
export class ReconcileBotIdSequence1775000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS bot_id_seq
      START WITH 1000
      INCREMENT BY 1
      MINVALUE 1000
    `);

    await queryRunner.query(`
      ALTER SEQUENCE bot_id_seq
      INCREMENT BY 1
      MINVALUE 1000
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        max_suffix bigint;
        current_last bigint;
        next_value bigint;
      BEGIN
        SELECT COALESCE(
          MAX(
            CASE
              WHEN bot_id ~ '^TDX[0-9]+$' THEN substring(bot_id from 4)::bigint
              ELSE NULL
            END
          ),
          999
        )
        INTO max_suffix
        FROM bot_accounts;

        SELECT last_value INTO current_last FROM bot_id_seq;

        next_value := GREATEST(max_suffix + 1, current_last + 1, 1000);

        PERFORM setval('bot_id_seq', next_value, false);
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: forward-only drift-repair migration
  }
}
