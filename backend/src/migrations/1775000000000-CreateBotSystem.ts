import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateBotSystem1775000000000 implements MigrationInterface {
  name = 'CreateBotSystem1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================================
    // Bot ID sequence
    // TDX1000 -> TDX1001 -> ... -> TDX9999 -> TDX10000
    // ============================================================

    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS bot_id_seq
      START WITH 1000
      INCREMENT BY 1
      MINVALUE 1000
    `);

    // ============================================================
    // bot_accounts
    // One User = One Bot Account
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_accounts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'bot_id',
            type: 'varchar',
            length: '32',
            isUnique: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'INACTIVE'",
          },
          {
            name: 'activated_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'principal',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'suspended_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'closed_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'bot_accounts',
      new TableForeignKey({
        name: 'FK_bot_accounts_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ============================================================
    // bot_wallets
    // One Bot Account = One Bot Wallet
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_wallets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'bot_account_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'available_balance',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'locked_balance',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'total_balance',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'version',
            type: 'integer',
            default: '0',
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'bot_wallets',
      new TableForeignKey({
        name: 'FK_bot_wallets_bot_account',
        columnNames: ['bot_account_id'],
        referencedTableName: 'bot_accounts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ============================================================
    // bot_wallet_transactions
    // Complete internal Bot Wallet ledger
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_wallet_transactions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'bot_wallet_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'varchar',
            length: '64',
          },
          {
            name: 'amount',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'balance_before',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'balance_after',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'PENDING'",
          },
          {
            name: 'reference_id',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'reference_type',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'bot_wallet_transactions',
      new TableForeignKey({
        name: 'FK_bot_wallet_transactions_wallet',
        columnNames: ['bot_wallet_id'],
        referencedTableName: 'bot_wallets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'bot_wallet_transactions',
      new TableIndex({
        name: 'IDX_bot_wallet_transactions_wallet',
        columnNames: ['bot_wallet_id'],
      }),
    );

    await queryRunner.createIndex(
      'bot_wallet_transactions',
      new TableIndex({
        name: 'IDX_bot_wallet_transactions_idempotency',
        columnNames: ['idempotency_key'],
        isUnique: true,
        where: '"idempotency_key" IS NOT NULL',
      }),
    );

    // ============================================================
    // bot_activations
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_activations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'bot_account_id',
            type: 'uuid',
          },
          {
            name: 'principal',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'liquidity_amount',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'first_referral_reserve',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'pending'",
          },
          {
            name: 'is_first_qualifying_activation',
            type: 'boolean',
            default: false,
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            isUnique: true,
          },
          {
            name: 'blockchain_tx_hash',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'activated_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'failure_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'bot_activations',
      new TableForeignKey({
        name: 'FK_bot_activations_bot_account',
        columnNames: ['bot_account_id'],
        referencedTableName: 'bot_accounts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'bot_activations',
      new TableIndex({
        name: 'IDX_bot_activations_bot_account_created',
        columnNames: ['bot_account_id', 'created_at'],
      }),
    );

    // ============================================================
    // bot_monthly_settlements
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_monthly_settlements',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'bot_account_id',
            type: 'uuid',
          },
          {
            name: 'period_start',
            type: 'date',
          },
          {
            name: 'period_end',
            type: 'date',
          },
          {
            name: 'principal',
            type: 'numeric',
            precision: 36,
            scale: 18,
          },
          {
            name: 'gross_generation',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'user_allocation',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'referral_allocation',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'referral_paid',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'referral_returned_to_liquidity',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '0',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'pending'",
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            isUnique: true,
          },
          {
            name: 'settled_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'failure_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'bot_monthly_settlements',
      new TableForeignKey({
        name: 'FK_bot_monthly_settlements_bot_account',
        columnNames: ['bot_account_id'],
        referencedTableName: 'bot_accounts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'bot_monthly_settlements',
      new TableIndex({
        name: 'UQ_bot_monthly_settlements_account_period',
        columnNames: ['bot_account_id', 'period_start', 'period_end'],
        isUnique: true,
      }),
    );

    // ============================================================
    // bot_settings
    // ============================================================

    await queryRunner.createTable(
      new Table({
        name: 'bot_settings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'minimum_activation',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '10000',
          },
          {
            name: 'maximum_activation',
            type: 'numeric',
            precision: 36,
            scale: 18,
            default: '1000000',
          },
          {
            name: 'liquidity_allocation_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '90',
          },
          {
            name: 'first_referral_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '10',
          },
          {
            name: 'monthly_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '6.5',
          },
          {
            name: 'monthly_user_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '5.5',
          },
          {
            name: 'monthly_referral_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '1',
          },

          {
            name: 'first_referral_level_1_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '6',
          },
          {
            name: 'first_referral_level_2_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '1.5',
          },
          {
            name: 'first_referral_level_3_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '1',
          },
          {
            name: 'first_referral_level_4_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.6',
          },
          {
            name: 'first_referral_level_5_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.5',
          },
          {
            name: 'first_referral_level_6_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.4',
          },

          {
            name: 'monthly_referral_level_1_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.55',
          },
          {
            name: 'monthly_referral_level_2_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.20',
          },
          {
            name: 'monthly_referral_level_3_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.10',
          },
          {
            name: 'monthly_referral_level_4_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.05',
          },
          {
            name: 'monthly_referral_level_5_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.05',
          },
          {
            name: 'monthly_referral_level_6_rate',
            type: 'numeric',
            precision: 10,
            scale: 4,
            default: '0.05',
          },

          {
            name: 'settlement_period',
            type: 'varchar',
            length: '32',
            default: "'monthly'",
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'updated_by',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    // ============================================================
    // Default settings
    // ============================================================

    await queryRunner.query(`
      INSERT INTO bot_settings (
        minimum_activation,
        maximum_activation,
        liquidity_allocation_rate,
        first_referral_rate,
        monthly_rate,
        monthly_user_rate,
        monthly_referral_rate,
        first_referral_level_1_rate,
        first_referral_level_2_rate,
        first_referral_level_3_rate,
        first_referral_level_4_rate,
        first_referral_level_5_rate,
        first_referral_level_6_rate,
        monthly_referral_level_1_rate,
        monthly_referral_level_2_rate,
        monthly_referral_level_3_rate,
        monthly_referral_level_4_rate,
        monthly_referral_level_5_rate,
        monthly_referral_level_6_rate,
        settlement_period,
        enabled
      )
      VALUES (
        '10000',
        '1000000',
        '90',
        '10',
        '6.5',
        '5.5',
        '1',
        '6',
        '1.5',
        '1',
        '0.6',
        '0.5',
        '0.4',
        '0.55',
        '0.20',
        '0.10',
        '0.05',
        '0.05',
        '0.05',
        'monthly',
        true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('bot_monthly_settlements', true, true, true);
    await queryRunner.dropTable('bot_activations', true, true, true);
    await queryRunner.dropTable('bot_wallet_transactions', true, true, true);
    await queryRunner.dropTable('bot_wallets', true, true, true);
    await queryRunner.dropTable('bot_accounts', true, true, true);
    await queryRunner.dropTable('bot_settings', true, true, true);
  }
}
