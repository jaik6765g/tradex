import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenTransactionHashForSolana1786000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Solana transaction signatures are base58 (~87 chars) — the prior
    // VARCHAR(66) cannot hold them. Additive widening; EVM/TRON rows intact.
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN transaction_hash TYPE VARCHAR(128);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN transaction_hash TYPE VARCHAR(66);`,
    );
  }
}