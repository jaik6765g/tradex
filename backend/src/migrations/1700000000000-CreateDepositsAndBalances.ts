import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDepositsAndBalances1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create deposits table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        
        -- Blockchain info
        chain_id INTEGER NOT NULL,
        transaction_hash VARCHAR(66) NOT NULL UNIQUE,
        block_number BIGINT NOT NULL,
        block_timestamp TIMESTAMP NOT NULL,
        
        -- Addresses
        vault_address VARCHAR(42) NOT NULL,
        sender_address VARCHAR(42) NOT NULL,
        
        -- Amounts
        amount VARCHAR(78) NOT NULL,
        usdt_amount DECIMAL(36,18) NOT NULL,
        tdx_amount DECIMAL(36,18) NOT NULL,
        
        -- Status tracking
        confirmations INTEGER DEFAULT 0,
        required_confirmations INTEGER DEFAULT 15,
        status VARCHAR(20) DEFAULT 'PENDING',
        
        -- Timestamps
        detected_at TIMESTAMP DEFAULT NOW(),
        confirmed_at TIMESTAMP,
        credited_at TIMESTAMP,
        
        -- Metadata
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Create indexes for deposits
    await queryRunner.query(`
      CREATE INDEX idx_deposits_user_id ON deposits(user_id);
      CREATE INDEX idx_deposits_tx_hash ON deposits(transaction_hash);
      CREATE INDEX idx_deposits_status ON deposits(status);
      CREATE INDEX idx_deposits_chain_id ON deposits(chain_id);
      CREATE INDEX idx_deposits_detected_at ON deposits(detected_at);
      CREATE INDEX idx_deposits_created_at ON deposits(created_at);
    `);

    // 3. Create balances table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        available_balance DECIMAL(36,18) DEFAULT 0,
        locked_balance DECIMAL(36,18) DEFAULT 0,
        game_locked DECIMAL(36,18) DEFAULT 0,
        trading_locked DECIMAL(36,18) DEFAULT 0,
        withdrawal_locked DECIMAL(36,18) DEFAULT 0,
        total_balance DECIMAL(36,18) DEFAULT 0,
        last_updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      );
    `);

    // 4. Create ledger_entries table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(36,18) NOT NULL,
        balance_before DECIMAL(36,18) NOT NULL,
        balance_after DECIMAL(36,18) NOT NULL,
        reference_id UUID,
        reference_type VARCHAR(50),
        description TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 5. Create indexes for ledger
    await queryRunner.query(`
      CREATE INDEX idx_ledger_user_id ON ledger_entries(user_id);
      CREATE INDEX idx_ledger_type ON ledger_entries(type);
      CREATE INDEX idx_ledger_reference_id ON ledger_entries(reference_id);
      CREATE INDEX idx_ledger_created_at ON ledger_entries(created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_entries`);
    await queryRunner.query(`DROP TABLE IF EXISTS balances`);
    await queryRunner.query(`DROP TABLE IF EXISTS deposits`);
  }
}
