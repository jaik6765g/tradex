import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenAddressColumnsForSolana1785000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Solana public keys are base58 Ed25519 pubkeys (43-44 chars) — the prior
    // VARCHAR(42) address columns cannot represent them. Additive widening
    // only; existing EVM/TRON data is preserved.
    await queryRunner.query(
      `ALTER TABLE deposit_addresses ALTER COLUMN address TYPE VARCHAR(64);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN deposit_address TYPE VARCHAR(64);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN sender_address TYPE VARCHAR(64);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN vault_address TYPE VARCHAR(64);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE deposit_addresses ALTER COLUMN address TYPE VARCHAR(42);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN deposit_address TYPE VARCHAR(42);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN sender_address TYPE VARCHAR(42);`,
    );
    await queryRunner.query(
      `ALTER TABLE deposits ALTER COLUMN vault_address TYPE VARCHAR(42);`,
    );
  }
}