import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePulseTradeTables1760000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "pulse_trades" (
                "id" uuid PRIMARY KEY,
                "userId" uuid NOT NULL,
                "pair" varchar(255) NOT NULL,
                "direction" varchar(20) NOT NULL,
                "duration" int NOT NULL,
                "amount" numeric(36,18) NOT NULL,
                "entryPrice" numeric(36,18) NOT NULL,
                "exitPrice" numeric(36,18),
                "result" varchar(20),
                "status" varchar(50) NOT NULL DEFAULT 'CREATED',
                "createdAt" timestamp NOT NULL,
                "expiryAt" timestamp NOT NULL,
                "settledAt" timestamp,
                "updatedAt" timestamp NOT NULL,
                CONSTRAINT "FK_pulse_trades_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "pulse_trade_snapshots" (
                "id" uuid PRIMARY KEY,
                "tradeId" uuid NOT NULL,
                "symbol" varchar(255) NOT NULL,
                "price" numeric(36,18) NOT NULL,
                "timestamp" timestamp NOT NULL,
                CONSTRAINT "FK_pulse_snapshots_trade" FOREIGN KEY ("tradeId") REFERENCES "pulse_trades"("id") ON DELETE CASCADE
            )
        `);

    await queryRunner.query(
      `CREATE INDEX "IDX_pulse_trades_userId" ON "pulse_trades" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pulse_trade_snapshots"`);
    await queryRunner.query(`DROP TABLE "pulse_trades"`);
  }
}
