// src/migrations/1700000000000-CreateLottoTables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLottoTables1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // LOTTO Rounds
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS lotto_rounds (
                id SERIAL PRIMARY KEY,
                round_number VARCHAR(50) UNIQUE NOT NULL,
                category VARCHAR(20) NOT NULL,
                status VARCHAR(20) DEFAULT 'OPEN',
                start_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cutoff_at TIMESTAMP NOT NULL,
                draw_at TIMESTAMP NOT NULL,
                result_id INT,
                result_generated_at TIMESTAMP,
                settled_at TIMESTAMP,
                failed_at TIMESTAMP,
                refunded_at TIMESTAMP,
                error_message TEXT,
                total_tickets INT DEFAULT 0,
                total_amount DECIMAL(18,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_lotto_rounds_category_status ON lotto_rounds(category, status);
            CREATE INDEX idx_lotto_rounds_draw_at ON lotto_rounds(draw_at);
        `);

    // LOTTO Tickets
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS lotto_tickets (
                id SERIAL PRIMARY KEY,
                ticket_number VARCHAR(50) UNIQUE NOT NULL,
                user_id INT NOT NULL,
                round_id INT NOT NULL,
                amount DECIMAL(18,2) NOT NULL,
                deduction_amount DECIMAL(18,2) NOT NULL,
                referral_amount DECIMAL(18,2) NOT NULL,
                admin_amount DECIMAL(18,2) NOT NULL,
                net_amount DECIMAL(18,2) NOT NULL,
                selected_numbers VARCHAR(50) NOT NULL,
                selection_count INT NOT NULL,
                multiplier DECIMAL(10,6) NOT NULL,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                win_amount DECIMAL(18,2),
                purchase_tx_id INT,
                settlement_tx_id INT,
                refund_tx_id INT,
                settled_at TIMESTAMP,
                refunded_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_lotto_tickets_user_round ON lotto_tickets(user_id, round_id);
            CREATE INDEX idx_lotto_tickets_status ON lotto_tickets(status);
            CREATE INDEX idx_lotto_tickets_ticket_number ON lotto_tickets(ticket_number);
        `);

    // LOTTO Results
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS lotto_results (
                id SERIAL PRIMARY KEY,
                round_id INT UNIQUE NOT NULL,
                result VARCHAR(1) NOT NULL,
                source VARCHAR(20) DEFAULT 'SERVER',
                admin_id INT,
                status VARCHAR(20) DEFAULT 'GENERATED',
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finalized_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_lotto_results_round_id ON lotto_results(round_id);
        `);

    // LOTTO Settlements
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS lotto_settlements (
                id SERIAL PRIMARY KEY,
                ticket_id INT UNIQUE NOT NULL,
                user_id INT NOT NULL,
                round_id INT NOT NULL,
                result VARCHAR(1) NOT NULL,
                outcome VARCHAR(20) DEFAULT 'PENDING',
                calculated_payout DECIMAL(18,2),
                payout_amount DECIMAL(18,2),
                status VARCHAR(20) DEFAULT 'PENDING',
                settled_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_lotto_settlements_ticket_id ON lotto_settlements(ticket_id);
            CREATE INDEX idx_lotto_settlements_user_id ON lotto_settlements(user_id);
            CREATE INDEX idx_lotto_settlements_round_id ON lotto_settlements(round_id);
            CREATE INDEX idx_lotto_settlements_status ON lotto_settlements(status);
        `);

    // Referral Bonuses
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS referral_bonuses (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                referrer_id INT NOT NULL,
                ticket_id INT NOT NULL,
                level VARCHAR(5) NOT NULL,
                amount DECIMAL(18,2) NOT NULL,
                percentage DECIMAL(5,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                transaction_id INT,
                distributed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_referral_bonuses_user_id ON referral_bonuses(user_id);
            CREATE INDEX idx_referral_bonuses_referrer_id ON referral_bonuses(referrer_id);
            CREATE INDEX idx_referral_bonuses_ticket_id ON referral_bonuses(ticket_id);
            CREATE INDEX idx_referral_bonuses_status ON referral_bonuses(status);
        `);

    // Admin Pool
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS admin_pool (
                id SERIAL PRIMARY KEY,
                total_balance DECIMAL(18,2) DEFAULT 0,
                locked_balance DECIMAL(18,2) DEFAULT 0,
                available_balance DECIMAL(18,2) DEFAULT 0,
                total_deposited DECIMAL(18,2) DEFAULT 0,
                total_withdrawn DECIMAL(18,2) DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Admin Pool Transactions
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS admin_pool_transactions (
                id SERIAL PRIMARY KEY,
                admin_pool_id INT NOT NULL,
                type VARCHAR(20) DEFAULT 'DEPOSIT',
                amount DECIMAL(18,2) NOT NULL,
                balance_before DECIMAL(18,2) NOT NULL,
                balance_after DECIMAL(18,2) NOT NULL,
                description VARCHAR(255),
                reference_id VARCHAR(100),
                admin_id INT,
                user_id INT,
                transaction_id INT,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_admin_pool_transactions_type ON admin_pool_transactions(type);
            CREATE INDEX idx_admin_pool_transactions_admin_id ON admin_pool_transactions(admin_id);
            CREATE INDEX idx_admin_pool_transactions_user_id ON admin_pool_transactions(user_id);
        `);

    // Admin Actions
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS admin_actions (
                id SERIAL PRIMARY KEY,
                admin_id INT NOT NULL,
                action VARCHAR(50) NOT NULL,
                target_type VARCHAR(50) NOT NULL,
                target_id VARCHAR(50) NOT NULL,
                old_value JSONB,
                new_value JSONB,
                ip_address VARCHAR(45),
                user_agent VARCHAR(255),
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_admin_actions_admin_id ON admin_actions(admin_id);
            CREATE INDEX idx_admin_actions_action ON admin_actions(action);
            CREATE INDEX idx_admin_actions_created_at ON admin_actions(created_at);
        `);

    // System Settings
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id SERIAL PRIMARY KEY,
                key VARCHAR(100) UNIQUE NOT NULL,
                value TEXT NOT NULL,
                type VARCHAR(50) NOT NULL,
                description VARCHAR(255),
                is_editable BOOLEAN DEFAULT TRUE,
                updated_by INT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX idx_system_settings_key ON system_settings(key);
        `);

    // Initial Admin Pool Record
    await queryRunner.query(`
            INSERT INTO admin_pool (total_balance, locked_balance, available_balance, total_deposited, total_withdrawn)
            VALUES (0, 0, 0, 0, 0);
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS system_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_actions`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_pool_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS admin_pool`);
    await queryRunner.query(`DROP TABLE IF EXISTS referral_bonuses`);
    await queryRunner.query(`DROP TABLE IF EXISTS lotto_settlements`);
    await queryRunner.query(`DROP TABLE IF EXISTS lotto_results`);
    await queryRunner.query(`DROP TABLE IF EXISTS lotto_tickets`);
    await queryRunner.query(`DROP TABLE IF EXISTS lotto_rounds`);
  }
}
