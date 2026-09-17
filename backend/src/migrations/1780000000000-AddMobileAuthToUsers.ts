import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMobileAuthToUsers1780000000000 implements MigrationInterface {
  name = 'AddMobileAuthToUsers1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Wallet address becomes optional — mobile/Supabase is now the login identity.
    // Every statement is idempotent so a partially-applied run can be re-run safely.
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN "walletAddress" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "mobileNumber" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "email" character varying(320)`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "authUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" character varying(20) NOT NULL DEFAULT 'user'`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_mobileNumber_unique" ON users ("mobileNumber")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email_unique" ON users ("email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_authUserId_unique" ON users ("authUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_authUserId_unique"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email_unique"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_mobileNumber_unique"`);

    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "role"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "authUserId"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "email"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS "mobileNumber"`);

    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN "walletAddress" SET NOT NULL`,
    );
  }
}
