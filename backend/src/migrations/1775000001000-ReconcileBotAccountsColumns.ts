import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReconcileBotAccountsColumns1775000001000 implements MigrationInterface {
  name = 'ReconcileBotAccountsColumns1775000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_accounts
      ADD COLUMN IF NOT EXISTS principal numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_accounts
      ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL
    `);

    await queryRunner.query(`
      ALTER TABLE bot_accounts
      ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_accounts
      DROP COLUMN IF EXISTS closed_at
    `);

    await queryRunner.query(`
      ALTER TABLE bot_accounts
      DROP COLUMN IF EXISTS suspended_at
    `);

    await queryRunner.query(`
      ALTER TABLE bot_accounts
      DROP COLUMN IF EXISTS principal
    `);
  }
}
