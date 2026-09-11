import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletAddressChainUniqueIndex1761000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallets_address_chainId_unique"
      ON wallets (address, "chainId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_wallets_address_chainId_unique"
    `);
  }
}
