import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPulseTradeLedgerUniquenessGuards1765000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'ledger_entries'
        ) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_trade_settlement_reference_unique"
          ON "ledger_entries" ("reference_id")
          WHERE "reference_type" = 'TRADE_SETTLEMENT'
            AND "reference_id" IS NOT NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ledger_trade_fee_allocation_reference_unique"
          ON "ledger_entries" ("reference_id")
          WHERE "reference_type" = 'TRADE_FEE_ALLOCATION'
            AND "reference_id" IS NOT NULL;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ledger_trade_fee_allocation_reference_unique"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ledger_trade_settlement_reference_unique"
    `);
  }
}
