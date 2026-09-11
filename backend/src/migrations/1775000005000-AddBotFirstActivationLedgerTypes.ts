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