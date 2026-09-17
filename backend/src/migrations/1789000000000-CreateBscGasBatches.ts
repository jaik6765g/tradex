import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBscGasBatches1789000000000 implements MigrationInterface {
  name = 'CreateBscGasBatches1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bsc_gas_batches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chain_id" integer NOT NULL DEFAULT 56, "status" varchar(32) NOT NULL, "total_bnb" numeric(36,18) NOT NULL, "recipient_count" integer NOT NULL DEFAULT 0, "idempotency_key" varchar(128) NOT NULL, "created_by" uuid, "gas_wallet_address" varchar(64), "failure_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bsc_gas_batches" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bsc_gas_batches_idempotency_unique" ON "bsc_gas_batches" ("idempotency_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bsc_gas_batches_status" ON "bsc_gas_batches" ("status")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bsc_gas_transfers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "batch_id" uuid NOT NULL, "recipient" varchar(64) NOT NULL, "amountBnb" numeric(36,18) NOT NULL, "amount_wei" numeric(78,0) NOT NULL, "status" varchar(32) NOT NULL, "tx_hash" varchar(66), "block_number" bigint, "confirmations" integer NOT NULL DEFAULT 0, "failure_reason" text, "confirmed_at" TIMESTAMPTZ, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bsc_gas_transfers" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bsc_gas_transfers_batch_recipient_unique" ON "bsc_gas_transfers" ("batch_id", "recipient")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bsc_gas_transfers_batchId" ON "bsc_gas_transfers" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bsc_gas_transfers_status" ON "bsc_gas_transfers" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bsc_gas_transfers_recipient" ON "bsc_gas_transfers" ("recipient")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bsc_gas_transfers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bsc_gas_batches"`);
  }
}
