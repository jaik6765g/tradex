import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts the daily-withdrawal-frequency setting to the approved canonical
 * JSON representation (Architecture Plan v3, decision 4):
 *
 *   {"mode":"COUNT","value":N}  -> at most N accepted withdrawals per day
 *   {"mode":"UNLIMITED"}        -> no daily cap
 *
 * Legacy representation was a plain number (valueType 'number'); legacy
 * semantics treated "0" as "check disabled", which maps exactly to
 * {"mode":"UNLIMITED"}.
 *
 * Idempotent: only rows still in legacy numeric form are converted.
 * If the row is entirely missing it is seeded with the approved default
 * (COUNT / 3) so the Admin Panel can display and edit it.
 *
 * ROLLBACK POLICY (Architecture Plan v3, correction 4):
 * - down() restores the legacy numeric form ONLY for {"mode":"COUNT"}
 *   rows (value-preserving).
 * - {"mode":"UNLIMITED"} rows have NO legacy numeric equivalent that
 *   preserves meaning, so they are left untouched and the rollback is
 *   partial by design (the service accepts both representations, so a
 *   partial rollback cannot break enforcement). No row is ever deleted
 *   and no administrator-customized value is ever discarded.
 */
export class ConvertWithdrawalFrequencySettingToJson1792000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Seed the canonical default when the row is entirely missing.
    await queryRunner.query(`
      INSERT INTO "admin_settings" ("key", "value", "valueType", "description", "editable")
      VALUES (
        'maxWithdrawalsPerUserPerDay',
        '{"mode":"COUNT","value":3}',
        'json',
        'Daily withdrawal frequency per user. JSON: {"mode":"COUNT","value":N} for N accepted withdrawals per Asia/Kolkata day, or {"mode":"UNLIMITED"} for no cap. Counts accepted lifecycle entries (REQUESTED..COMPLETED); excludes REJECTED/FAILED/CANCELLED. Enforced server-side inside the locked withdrawal transaction.',
        true
      )
      ON CONFLICT ("key") DO NOTHING
    `);

    // 2. Convert legacy numeric values (positive -> COUNT, non-positive ->
    //    UNLIMITED) while leaving any already-JSON rows untouched.
    await queryRunner.query(`
      UPDATE "admin_settings"
      SET
        "value" = CASE
          WHEN ("value"::numeric) > 0
            THEN json_build_object('mode', 'COUNT', 'value', floor("value"::numeric))::text
          ELSE '{"mode":"UNLIMITED"}'
        END,
        "valueType" = 'json'
      WHERE "key" = 'maxWithdrawalsPerUserPerDay'
        AND "valueType" = 'number'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore legacy numeric form only where it is value-preserving
    // (COUNT mode). UNLIMITED rows are left untouched — documented above.
    await queryRunner.query(`
      UPDATE "admin_settings"
      SET
        "value" = COALESCE("value"::json ->> 'value', '3'),
        "valueType" = 'number'
      WHERE "key" = 'maxWithdrawalsPerUserPerDay'
        AND "valueType" = 'json'
        AND COALESCE("value"::json ->> 'mode', 'COUNT') = 'COUNT'
    `);
  }
}
