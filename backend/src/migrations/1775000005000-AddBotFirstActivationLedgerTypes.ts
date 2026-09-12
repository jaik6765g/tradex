import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add Bot first-activation referral ledger types.
 *
 * Adds two new values to the ledger_entries_type_enum PostgreSQL enum:
 *
 *   BOT_FIRST_ACTIVATION_REFERRAL  - referral credit to an eligible upline
 *   BOT_FIRST_ACTIVATION_LIQUIDITY  - unallocated referral routed to liquidity
 *
 * These support the Phase 1 first-activation referral distribution feature.
 */
export class AddBotFirstActivationLedgerTypes1775000005000
  implements MigrationInterface
{
  name = 'AddBotFirstActivationLedgerTypes1775000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================================
    // Render-schema safety: detect whether the enum type actually
    // exists on the current PostgreSQL schema (pg_type check)
    // BEFORE altering it. If the enum was never created on this
    // schema, this migration is a safe no-op (no error thrown,
    // no replacement enum invented, schema/data preserved).
    // ============================================================

    const enumExistsResult: Array<{ exists: boolean }> =
      await queryRunner.query(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_type
           WHERE typname = 'ledger_entries_type_enum'
         ) AS exists`,
      );

    const enumExists = Boolean(enumExistsResult?.[0]?.exists);

    if (!enumExists) {
      return;
    }

    await queryRunner.query(
      `ALTER TYPE ledger_entries_type_enum ADD VALUE IF NOT EXISTS 'BOT_FIRST_ACTIVATION_REFERRAL'`,
    );
    await queryRunner.query(
      `ALTER TYPE ledger_entries_type_enum ADD VALUE IF NOT EXISTS 'BOT_FIRST_ACTIVATION_LIQUIDITY'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type.
    // The values are safely ignorable if the feature is reverted.
  }
}