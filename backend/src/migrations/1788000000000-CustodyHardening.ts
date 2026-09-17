import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custody hardening (TradeX master-seed + key-compromise emergency hardening).
 *
 * Adds:
 *   1. deposit_addresses.custody_generation — generation/version tag so a
 *      post-compromise new generation can coexist with old-generation
 *      historical addresses.
 *   2. deposit_addresses.status now allows 'COMPROMISED' (enum is app-level;
 *      the VARCHAR column already accommodates it — no DDL needed for the
 *      value itself).
 *   3. custody_audit_logs — append-only audit trail for emergency custody
 *      actions (no secrets are ever written here).
 *
 * Additive and safe for existing rows.
 */
export class CustodyHardening1788000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE deposit_addresses ADD COLUMN IF NOT EXISTS custody_generation INTEGER NOT NULL DEFAULT 1;`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS custody_audit_logs (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         actor_id UUID,
         action VARCHAR(64) NOT NULL,
         network VARCHAR(32),
         address VARCHAR(64),
         deposit_address_id UUID,
         custody_generation INTEGER,
         reason TEXT,
         result VARCHAR(32) NOT NULL,
         correlation_id VARCHAR(64),
         metadata JSONB NOT NULL DEFAULT '{}',
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_custody_audit_logs_createdAt" ON custody_audit_logs (created_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_custody_audit_logs_action" ON custody_audit_logs (action);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_custody_audit_logs_address" ON custody_audit_logs (address) WHERE address IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS custody_audit_logs;`);
    await queryRunner.query(
      `ALTER TABLE deposit_addresses DROP COLUMN IF EXISTS custody_generation;`,
    );
  }
}
