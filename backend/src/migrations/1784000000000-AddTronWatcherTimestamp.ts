import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTronWatcherTimestamp1784000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // TRON TronGrid paginates TRC-20 transfers by ms timestamp; persist a
    // timestamp cursor alongside the existing block cursor (EVM only).
    await queryRunner.query(`
      ALTER TABLE gateway_watcher_state
        ADD COLUMN IF NOT EXISTS last_processed_timestamp BIGINT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE gateway_watcher_state
        DROP COLUMN IF EXISTS last_processed_timestamp;
    `);
  }
}
