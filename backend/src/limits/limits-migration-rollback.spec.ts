// Migration rollback-safety (Architecture Plan v3, correction 4):
// the migration files are plain SQL strings, so this spec asserts the
// rollback guarantees statically against the migration source.
//
// LOCATION MATTERS: this spec deliberately lives OUTSIDE src/migrations/.
// The TypeORM DataSource migration glob is `src/migrations/*{.ts,.js}` and
// TypeORM `require`s every file it matches, so a *.spec.ts inside that
// directory makes `npm run migration:run` abort with
// `ReferenceError: describe is not defined`. Keeping it here (Jest rootDir
// is `src`, testRegex `.*\.spec\.ts$`) means Jest still discovers it while
// the migration glob only ever matches real migration files.
//
// MIGRATIONS_DIR therefore resolves to ../migrations from this directory.

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

describe('Deposit/Withdrawal limit migrations — rollback safety', () => {
  const seedMigration = readFileSync(
    join(MIGRATIONS_DIR, '1792000000000-SeedDepositWithdrawalLimitSettings.ts'),
    'utf8',
  );
  const frequencyMigration = readFileSync(
    join(
      MIGRATIONS_DIR,
      '1792000000001-ConvertWithdrawalFrequencySettingToJson.ts',
    ),
    'utf8',
  );

  it('seeds all four limit settings with the approved defaults (10 / 10000 / 5 / 500)', () => {
    expect(seedMigration).toContain("'minDepositUsdt', '10'");
    expect(seedMigration).toContain("'maxDepositUsdt', '10000'");
    expect(seedMigration).toContain("'minWithdrawalUsdt', '5'");
    expect(seedMigration).toContain("'maxWithdrawalUsdt', '500'");
  });

  it('uses ON CONFLICT (key) DO NOTHING — never overwrites customized values', () => {
    expect(seedMigration).toContain('ON CONFLICT ("key") DO NOTHING');
  });

  it('seed down() is a no-op — no DELETE/UPDATE of administrator-customized rows', () => {
    // Extract the down() body and ensure it contains no destructive SQL.
    const down = seedMigration.slice(
      seedMigration.indexOf('public async down'),
      seedMigration.lastIndexOf('}'),
    );
    expect(down).not.toMatch(/DELETE FROM/i);
    expect(down).not.toMatch(/UPDATE\s+"?admin_settings/i);
    expect(down).not.toMatch(/DROP TABLE/i);
  });

  it('frequency migration converts to the canonical JSON representation', () => {
    expect(frequencyMigration).toContain("json_build_object('mode', 'COUNT'");
    expect(frequencyMigration).toContain("'{" + '"mode":"UNLIMITED"' + "}'");
    expect(frequencyMigration).toContain(
      "valueType\" = 'json'".replace('\"', '"'),
    );
  });

  it('frequency down() preserves COUNT rows value-for-value and never deletes', () => {
    const down = frequencyMigration.slice(
      frequencyMigration.indexOf('public async down'),
      frequencyMigration.lastIndexOf('}'),
    );

    // Restores the numeric value from the JSON payload.
    expect(down).toContain("->> 'value'");
    expect(down).toContain("valueType\" = 'number'".replace('\"', '"'));
    // Only COUNT rows are converted back; UNLIMITED rows are left untouched.
    expect(down).toContain("'mode', 'COUNT'");
    expect(down).not.toMatch(/DELETE FROM/i);
    expect(down).not.toMatch(/DROP TABLE/i);
  });

  it('frequency down() leaves UNLIMITED rows untouched (no lossy conversion)', () => {
    const down = frequencyMigration.slice(
      frequencyMigration.indexOf('public async down'),
      frequencyMigration.lastIndexOf('}'),
    );
    // The WHERE clause restricts the rollback to mode='COUNT'.
    expect(down).toMatch(/mode.*COUNT/);
  });

  it('frequency up() seeds the default (COUNT/3) only when the row is missing', () => {
    expect(frequencyMigration).toContain('ON CONFLICT ("key") DO NOTHING');
    expect(frequencyMigration).toContain('\'{"mode":"COUNT","value":3}\'');
  });
});
