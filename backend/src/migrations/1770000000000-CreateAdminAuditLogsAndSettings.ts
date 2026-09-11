import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAuditLogsAndSettings1770000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "adminId" uuid NOT NULL,
        "action" varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL,
        "targetId" varchar(100),
        "oldValue" jsonb,
        "newValue" jsonb,
        "ipAddress" varchar(64),
        "userAgent" varchar(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_adminId"
      ON "admin_audit_logs" ("adminId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_action"
      ON "admin_audit_logs" ("action")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_createdAt"
      ON "admin_audit_logs" ("createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_settings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" varchar(100) NOT NULL,
        "value" text NOT NULL,
        "valueType" varchar(30) NOT NULL DEFAULT 'string',
        "description" text,
        "editable" boolean NOT NULL DEFAULT true,
        "updatedBy" uuid,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_settings_key_unique"
      ON "admin_settings" ("key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_settings_key_unique"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_settings"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_audit_logs_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_audit_logs_action"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_admin_audit_logs_adminId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_logs"`);
  }
}
