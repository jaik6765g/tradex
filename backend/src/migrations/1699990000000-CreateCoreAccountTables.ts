import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCoreAccountTables1699990000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "walletAddress" VARCHAR(42) NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_walletAddress_unique"
      ON users ("walletAddress")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        address VARCHAR(42) NOT NULL,
        "chainId" INTEGER NOT NULL,
        "isPrimary" BOOLEAN NOT NULL DEFAULT true,
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wallets_address" ON wallets (address);
      CREATE INDEX IF NOT EXISTS "IDX_wallets_chainId" ON wallets ("chainId");
      CREATE INDEX IF NOT EXISTS "IDX_wallets_userId" ON wallets ("userId");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallets_address_chainId_unique"
      ON wallets (address, "chainId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_nonces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "walletAddress" VARCHAR(42) NOT NULL,
        nonce VARCHAR(128) NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_nonces_walletAddress"
      ON auth_nonces ("walletAddress")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "walletAddress" VARCHAR(42) NOT NULL,
        "chainId" INTEGER NOT NULL,
        "tokenAddress" VARCHAR(42) NOT NULL,
        "tdxAmount" NUMERIC(36,18) NOT NULL,
        "usdtAmount" NUMERIC(36,18) NOT NULL,
        fee NUMERIC(36,18) NOT NULL DEFAULT '0',
        status VARCHAR(40) NOT NULL DEFAULT 'REQUESTED',
        "riskPassed" BOOLEAN NOT NULL DEFAULT false,
        "liquidityPassed" BOOLEAN NOT NULL DEFAULT false,
        "adminApproved" BOOLEAN NOT NULL DEFAULT false,
        "approvedBy" UUID,
        "txHash" VARCHAR(100),
        "payoutAttempted" BOOLEAN NOT NULL DEFAULT false,
        "payoutIdempotencyKey" VARCHAR(100),
        "payoutSubmittedAt" TIMESTAMP,
        "payoutConfirmedAt" TIMESTAMP,
        "rejectionReason" TEXT,
        "riskReason" TEXT,
        "verifiedAt" TIMESTAMP,
        "processedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_withdrawals_user_createdAt"
      ON withdrawals ("userId", "createdAt");
      CREATE INDEX IF NOT EXISTS "IDX_withdrawals_txHash" ON withdrawals ("txHash");
      CREATE INDEX IF NOT EXISTS "IDX_withdrawals_user_status" ON withdrawals ("userId", status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_withdrawals_user_status"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_withdrawals_txHash"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_withdrawals_user_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS withdrawals`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_auth_nonces_walletAddress"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS auth_nonces`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallets_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallets_chainId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallets_address"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wallets_address_chainId_unique"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS wallets`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_users_walletAddress_unique"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
