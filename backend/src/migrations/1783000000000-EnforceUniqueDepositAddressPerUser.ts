import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceUniqueDepositAddressPerUser1783000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // One USDT deposit address per (user, network). The partial index ignores
    // rows with a NULL user_id (pool infrastructure addresses remain allowed).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_deposit_addresses_user_chain_unique"
        ON deposit_addresses (user_id, chain_id)
        WHERE user_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_deposit_addresses_user_chain_unique"`,
    );
  }
}
