import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconcile bot_wallet_transactions schema drift.
 *
 * The entity (and BotService) reference `status` and `description`, but
 * the live PostgreSQL table was created before those columns were added
 * to the CreateBotSystem migration. This migration aligns the DB with the
 * entity contract:
 *
 *   status      varchar(32)  NOT NULL DEFAULT 'PENDING'
 *   description text         NULL
 */
export class ReconcileBotWalletTransactionColumns1775000003000
  implements MigrationInterface
{
  name = 'ReconcileBotWalletTransactionColumns1775000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_wallet_transactions
      ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'PENDING'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_wallet_transactions
      ADD COLUMN IF NOT EXISTS "description" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bot_wallet_transactions
      DROP COLUMN IF EXISTS "description"
    `);

    await queryRunner.query(`
      ALTER TABLE bot_wallet_transactions
      DROP COLUMN IF EXISTS "status"
    `);
  }
}
