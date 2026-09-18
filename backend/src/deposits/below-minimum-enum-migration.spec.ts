// Static safety assertions for the BELOW_MINIMUM enum migration.
//
// The migration is a plain SQL string, so these assertions inspect its source.
// Deliberately located OUTSIDE src/migrations/: the TypeORM DataSource
// migration glob is `src/migrations/*{.ts,.js}` and TypeORM `require`s every
// file it matches, so a *.spec.ts inside that directory makes
// `npm run migration:run` abort with `ReferenceError: describe is not defined`.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const FILE = '1792000000002-AddBelowMinimumDepositStatusEnumValue.ts';

const source = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8');
const downBody = source.slice(
  source.indexOf('public async down'),
  source.lastIndexOf('}'),
);

describe('AddBelowMinimumDepositStatusEnumValue1792000000002', () => {
  it('exists in the migrations directory with the correct timestamp suffix', () => {
    expect(readdirSync(MIGRATIONS_DIR)).toContain(FILE);
    // TypeORM parses the trailing 13 digits of the class name as the
    // timestamp, so the class name must end with the file's timestamp.
    expect(source).toContain(
      'export class AddBelowMinimumDepositStatusEnumValue1792000000002',
    );
    expect(
      parseInt(
        'AddBelowMinimumDepositStatusEnumValue1792000000002'.slice(-13),
        10,
      ),
    ).toBe(1792000000002);
    expect(1792000000002).toBeGreaterThan(1792000000001);
  });

  it('runs strictly after the existing limits migrations (timestamp ordering)', () => {
    expect(source).toContain('1792000000002');
    const limits = readdirSync(MIGRATIONS_DIR).filter((f) =>
      /^179200000000[01]/.test(f),
    );
    expect(limits.length).toBe(2);
  });

  it('uses a guarded DO block that checks public.deposits_status_enum exists', () => {
    expect(source).toContain('DO $$');
    expect(source).toContain('IF EXISTS (');
    expect(source).toContain("n.nspname = 'public'");
    expect(source).toContain("t.typname = 'deposits_status_enum'");
    expect(source).toContain('END IF;');
    expect(source).toContain('$$;');
  });

  it('adds BELOW_MINIMUM idempotently via ADD VALUE IF NOT EXISTS', () => {
    expect(source).toContain('ALTER TYPE "deposits_status_enum"');
    expect(source).toContain("ADD VALUE IF NOT EXISTS 'BELOW_MINIMUM'");
  });

  it('is a no-op when deposits.status is VARCHAR (no column alteration at all)', () => {
    // If the enum type does not exist, the guarded IF EXISTS is skipped.
    expect(source).not.toMatch(/ALTER\s+TABLE/i);
    expect(source).not.toMatch(/ALTER\s+COLUMN/i);
    expect(source).not.toMatch(/\bUSING\b/i);
    expect(source).not.toMatch(
      /\bALTER\s+TYPE\s+"?deposits_status_enum"?\s+ALTER/i,
    );
    expect(source).not.toMatch(/\bSET\s+DATA\s+TYPE\b/i);
  });

  it('is non-destructive: no DML/DDL beyond the enum label addition', () => {
    const upBody = source.slice(
      source.indexOf('public async up'),
      source.indexOf('public async down'),
    );
    expect(upBody).not.toMatch(/\bDROP\s+(TABLE|TYPE|COLUMN|INDEX)\b/i);
    expect(upBody).not.toMatch(/\bTRUNCATE\b/i);
    expect(upBody).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(upBody).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(upBody).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(upBody).not.toMatch(/\bCREATE\s+(TABLE|TYPE)\b/i);
  });

  it('has a documented no-op down() that destroys nothing', () => {
    expect(source).toContain('public async down');
    expect(downBody).not.toMatch(/ALTER\s+TYPE/i);
    expect(downBody).not.toMatch(/\bDROP\b/i);
    expect(downBody).not.toMatch(/\bDELETE\b/i);
    expect(downBody).not.toMatch(/\bUPDATE\b/i);
    expect(downBody).not.toMatch(/queryRunner\.query/);
  });

  it('never uses the new enum value in the same migration (PG transaction rule)', () => {
    // A value added inside a transaction cannot be USED in that transaction.
    // Restrict the check to the executed SQL (template literals): the label
    // must appear exactly once and only inside the ALTER ... ADD VALUE
    // statement, which is itself the only statement in the migration.
    const sql = (source.match(/`[^`]*`/g) ?? []).join('\n');
    const uses = sql.match(/'BELOW_MINIMUM'/g) ?? [];
    expect(uses.length).toBe(1);
    expect(sql).toMatch(
      /ALTER TYPE "deposits_status_enum" ADD VALUE IF NOT EXISTS 'BELOW_MINIMUM'/,
    );
    // Exactly one executable statement is issued by this migration.
    expect(source.match(/queryRunner\.query\(/g) ?? []).toHaveLength(1);
    // The label is introduced by ALTER TYPE, never by DML keywords.
    const labelIndex = sql.indexOf("'BELOW_MINIMUM'");
    expect(sql.lastIndexOf('ALTER TYPE', labelIndex)).toBeGreaterThan(-1);
    expect(sql.slice(0, labelIndex)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('does not duplicate any pre-existing enum migration for the same type', () => {
    const others = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.ts') && f !== FILE)
      .filter((f) =>
        readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes(
          'deposits_status_enum',
        ),
      );
    expect(others).toEqual([]);
  });

  it('keeps src/migrations free of spec files (migration-glob safety)', () => {
    const specs = readdirSync(MIGRATIONS_DIR).filter((f) =>
      f.includes('.spec.'),
    );
    expect(specs).toEqual([]);
  });
});
