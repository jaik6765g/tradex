import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.2 — Sweep hardening: store the signed raw transaction so a sweep
 * can be recovered idempotently after a crash between broadcast and persistence.
 *
 * The signed raw tx is deterministic (its keccak256 IS the EVM tx hash), so
 * re-broadcasting it is safe and produces the same hash. This closes the
 * crash window that could otherwise cause a double-sweep on retry.
 *
 * Additive: existing rows keep signed_tx_raw = NULL (legacy PENDING sweeps
 * without a stored raw tx fall back to MANUAL_REVIEW on recovery).
 */
export class AddSignedTxRawToSweeps1787000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE deposit_sweeps ADD COLUMN signed_tx_raw TEXT;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE deposit_sweeps DROP COLUMN signed_tx_raw;`,
    );
  }
}
