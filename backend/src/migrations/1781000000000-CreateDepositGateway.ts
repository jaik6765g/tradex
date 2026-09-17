import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDepositGateway1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Deposit orders (gateway order lifecycle)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deposit_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chain_id INTEGER NOT NULL,
        asset_symbol VARCHAR(32) NOT NULL,
        token_address VARCHAR(42) NOT NULL,
        amount NUMERIC(36,18) NOT NULL,
        expected_tdx NUMERIC(36,18) NOT NULL,
        status VARCHAR(32) NOT NULL,
        deposit_address_id UUID,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_deposit_orders_userId" ON deposit_orders (user_id);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_orders_status" ON deposit_orders (status);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_orders_expiresAt" ON deposit_orders (expires_at);
    `);

    // 2. TradeX deposit addresses (gateway infrastructure, separate from wallets)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deposit_addresses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        address VARCHAR(42) NOT NULL,
        chain_id INTEGER NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        order_id UUID,
        status VARCHAR(32) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_deposit_addresses_address_chainId_unique"
        ON deposit_addresses (address, chain_id);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_addresses_userId" ON deposit_addresses (user_id);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_addresses_orderId" ON deposit_addresses (order_id);
      CREATE INDEX IF NOT EXISTS "IDX_deposit_addresses_status" ON deposit_addresses (status);
    `);

    // 3. Watcher checkpoint per chain (persist last processed block)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS gateway_watcher_state (
        chain_id INTEGER PRIMARY KEY,
        last_processed_block BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Make the legacy deposits.wallet_id nullable and add gateway columns.
    await queryRunner.query(`
      ALTER TABLE deposits ALTER COLUMN wallet_id DROP NOT NULL;
      ALTER TABLE deposits ADD COLUMN IF NOT EXISTS order_id UUID;
      ALTER TABLE deposits ADD COLUMN IF NOT EXISTS deposit_address VARCHAR(42);
      CREATE INDEX IF NOT EXISTS idx_deposits_order_id ON deposits (order_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_deposits_order_id`);
    await queryRunner.query(
      `ALTER TABLE deposits DROP COLUMN IF EXISTS deposit_address`,
    );
    await queryRunner.query(`ALTER TABLE deposits DROP COLUMN IF EXISTS order_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS gateway_watcher_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS deposit_addresses`);
    await queryRunner.query(`DROP TABLE IF EXISTS deposit_orders`);
  }
}
