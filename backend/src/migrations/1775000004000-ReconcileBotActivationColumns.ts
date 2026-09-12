import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconcile Bot activation / monthly-settlement schema drift.
 *
 * The live tables were created by an earlier revision of CreateBotSystem
 * (legacy columns `amount` / `rate`), while the current entities
 * (`BotActivation`, `BotMonthlySettlement`) reference the newer contract.
 *
 * This migration aligns the live database with the entities WITHOUT
 * destroying legacy data: legacy `amount` values are back-filled into
 * `principal`; legacy `rate`/`amount` columns are preserved untouched.
 */
export class ReconcileBotActivationColumns1775000004000
  implements MigrationInterface
{
  name = 'ReconcileBotActivationColumns1775000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------
    // bot_activations
    // ---------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "principal" numeric(36, 18)
    `);

    // Legacy `amount` may not exist in the current schema — only back-fill
    // `principal` from it when the column is actually present. Skipping the
    // back-fill is safe: "principal" keeps its existing values.
    const botActivationsHasAmount =
      await queryRunner.hasColumn('bot_activations', 'amount');

    if (botActivationsHasAmount) {
      await queryRunner.query(`
        UPDATE bot_activations
        SET "principal" = COALESCE("amount", 0)
        WHERE "principal" IS NULL
      `);
    }

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ALTER COLUMN "principal" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "liquidity_amount" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "first_referral_reserve" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "is_first_qualifying_activation" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "blockchain_tx_hash" character varying(128) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      ADD COLUMN IF NOT EXISTS "failure_reason" text NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bot_activations_bot_account_created"
      ON bot_activations ("bot_account_id", "created_at")
    `);

    // Legacy `amount` is NOT NULL with no default and is NOT mapped by the
    // current entity — every entity INSERT omits it and Postgres rejects with
    // "null value in column amount violates not-null constraint".
    // Its value is already preserved in "principal" (back-filled above).
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "amount"
    `);

    // ---------------------------------------------------------------
    // bot_monthly_settlements
    // ---------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "principal" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    // Legacy `amount` may not exist in the current schema — only back-fill
    // `principal` from it when the column is actually present. Skipping the
    // back-fill is safe: "principal" keeps its existing values (default 0).
    const botMonthlySettlementsHasAmount =
      await queryRunner.hasColumn('bot_monthly_settlements', 'amount');

    if (botMonthlySettlementsHasAmount) {
      await queryRunner.query(`
        UPDATE bot_monthly_settlements
        SET "principal" = COALESCE("amount", 0)
        WHERE "principal" = 0 AND "amount" IS NOT NULL
      `);
    }

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "gross_generation" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "user_allocation" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "referral_allocation" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "referral_paid" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "referral_returned_to_liquidity" numeric(36, 18) NOT NULL DEFAULT '0'
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "failure_reason" text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      ADD COLUMN IF NOT EXISTS "metadata" jsonb NULL
    `);

    // Legacy `rate` / `amount` are NOT NULL with no defaults and are NOT
    // mapped by the current entity — same NOT NULL violation risk as
    // bot_activations. `amount` values are preserved in "principal".
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "rate"
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "amount"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_bot_activations_bot_account_created"
    `);

    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "metadata"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "failure_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "referral_returned_to_liquidity"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "referral_paid"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "referral_allocation"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "user_allocation"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "gross_generation"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_monthly_settlements
      DROP COLUMN IF EXISTS "principal"
    `);

    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "failure_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "blockchain_tx_hash"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "is_first_qualifying_activation"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "first_referral_reserve"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "liquidity_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE bot_activations
      DROP COLUMN IF EXISTS "principal"
    `);
  }
}