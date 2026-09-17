import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustodySweepColumns1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Custody metadata on deposit_addresses (provider + HD derivation).
    await queryRunner.query(`
      ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS provider VARCHAR(64);
      ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS derivation_index INTEGER;
      ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS derivation_path VARCHAR(128);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_deposit_addresses_provider_chain_derivation_unique"
        ON deposit_addresses (provider, chain_id, derivation_index)
        WHERE provider IS NOT NULL AND derivation_index IS NOT NULL;
    `);

    // 2. Sweep records (idempotent, one sweep per deposit).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deposit_sweeps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deposit_id UUID UNIQUE,
        deposit_address_id UUID,
        chain_id INTEGER NOT NULL,
        asset_symbol VARCHAR(32) NOT NULL,
        token_address VARCHAR(42) NOT NULL,
        amount NUMERIC(36,18) NOT NULL,
        destination_address VARCHAR(42) NOT NULL,
        status VARCHAR(32) NOT NULL,
        sweep_tx_hash VARCHAR(66),
        failure_reason TEXT,
        submitted_at TIMESTAMPTZ,
        confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deposit_sweeps_status" ON deposit_sweeps (status);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_sweeps_depositAddressId" ON deposit_sweeps (deposit_address_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS deposit_sweeps`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_deposit_addresses_provider_chain_derivation_unique"`,
    );
    await queryRunner.query(
      `ALTER TABLE deposit_addresses DROP COLUMN IF EXISTS derivation_path`,
    );
    await queryRunner.query(
      `ALTER TABLE deposit_addresses DROP COLUMN IF EXISTS derivation_index`,
    );
    await queryRunner.query(
      `ALTER TABLE deposit_addresses DROP COLUMN IF EXISTS provider`,
    );
  }
}
