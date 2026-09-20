import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * E20 — migration rollback safety for the source-aware hardening migration.
 *
 * Migration files are plain SQL strings, so these assertions are made
 * statically against the migration source. This spec lives OUTSIDE
 * src/migrations/ on purpose: the TypeORM DataSource glob is
 * `src/migrations/*{.ts,.js}`, and a *.spec.ts inside that directory would
 * break `migration:run` (`describe is not defined`).
 */
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const MIGRATION_FILE =
  '1793000000000-SourceAwareWageringAndWithdrawalHardening.ts';

describe('Source-aware hardening migration — rollback safety', () => {
  const source = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
  const downBody = source.slice(
    source.indexOf('public async down'),
    source.lastIndexOf('}\n}'),
  );

  it('never uses destructive CASCADE operations', () => {
    // Comments deliberately mention "no CASCADE", so assert on executable SQL.
    expect(source).not.toMatch(/ON DELETE CASCADE/i);
    expect(source).not.toMatch(/DROP\s+[A-Z_ "]*CASCADE/i);
  });

  it('is idempotent (IF NOT EXISTS / guarded blocks) so re-running is a no-op', () => {
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "sourceType"');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS "wallet_source_allocations"');
    expect(source).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_wagering_obligations_source"',
    );
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "clientRequestId"');
  });

  it('adds the unique payoutIdempotencyKey index only AFTER duplicate handling', () => {
    const duplicateScanIndex = source.indexOf('ROW_NUMBER() OVER');
    const uniqueIndexPos = source.indexOf(
      '"IDX_withdrawals_payoutIdempotencyKey_unique"',
    );
    expect(duplicateScanIndex).toBeGreaterThan(-1);
    expect(uniqueIndexPos).toBeGreaterThan(duplicateScanIndex);
  });

  it('preserves duplicate payout keys in metadata instead of deleting financial rows', () => {
    expect(source).toContain("'payoutIdempotencyKeyDuplicate'");
    expect(source).toContain('"payoutIdempotencyKey" = NULL');
    // No row is ever deleted from withdrawals.
    expect(source).not.toMatch(/DELETE\s+FROM\s+"?withdrawals"?/i);
  });

  it('enforces the (userId, clientRequestId) unique anchor', () => {
    expect(source).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_withdrawals_user_clientRequestId_unique"',
    );
    expect(source).toContain('("userId", "clientRequestId")');
  });

  it('creates the FIFO attribution table with balance-preserving CHECKs', () => {
    expect(source).toContain('CHK_wallet_source_allocations_bounds');
    expect(source).toContain(
      '"consumedAmount" + "reservedAmount" <= "originalAmount"',
    );
    expect(source).toContain('UQ_wallet_source_allocations_source');
  });

  it('down() REFUSES to run while live attribution rows exist', () => {
    expect(downBody).toContain('wallet_source_allocations');
    expect(downBody).toMatch(/rollback refused/i);
    expect(downBody).toContain('allocationCount > 0');
  });

  it('down() REFUSES to run while non-deposit obligations exist', () => {
    expect(downBody).toContain('nonDepositObligations');
    expect(downBody).toContain(`"sourceType" <> 'DEPOSIT'`);
  });

  it('down() REFUSES to run while withdrawals carry clientRequestId history', () => {
    expect(downBody).toContain('clientRequestCount');
    expect(downBody).toContain(`"clientRequestId" IS NOT NULL`);
  });

  it('down() REFUSES to lose the duplicate-payout-key audit trail', () => {
    expect(downBody).toContain('duplicatePayoutKeyCount');
    expect(downBody).toContain(`"metadata" ? 'payoutIdempotencyKeyDuplicate'`);
  });

  it('down() performs no DELETE of financial history', () => {
    expect(downBody).not.toMatch(/DELETE\s+FROM/i);
    expect(downBody).not.toMatch(/CASCADE/i);
  });

  it('down() restores the legacy depositId NOT NULL contract for empty deployments', () => {
    expect(downBody).toContain('ALTER COLUMN "depositId" SET NOT NULL');
    expect(downBody).toContain(
      'ADD CONSTRAINT "UQ_wagering_obligations_deposit" UNIQUE ("depositId")',
    );
  });
});
