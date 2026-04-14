// Database migration script for TaskFlow Pro
const db = require('../src/utils/db');
const logger = require('../src/utils/logger');

async function runMigrations() {
  logger.info('Starting database migrations...');
  
  if (!db.useDemo) {
    const pool = db.getPool();
    
    try {
      // Create organizations table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS organizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          plan VARCHAR(50) DEFAULT 'basic',
          settings JSONB DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create subscription_plans table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          features JSONB DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create subscriptions table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          plan_id VARCHAR(50) REFERENCES subscription_plans(id),
          status VARCHAR(20) DEFAULT 'active',
          seats INTEGER DEFAULT 1,
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create users table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'employee',
          manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
          is_active BOOLEAN DEFAULT true,
          email_verified BOOLEAN DEFAULT false,
          last_login_at TIMESTAMP,
          department VARCHAR(100),
          employee_code VARCHAR(50),
          phone_e164 VARCHAR(20),
          whatsapp_e164 VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Insert default subscription plans
      await pool.query(`
        INSERT INTO subscription_plans (id, name, features) VALUES
        ('basic', 'Basic Plan', '["tasks", "reports"]'),
        ('pro', 'Pro Plan', '["tasks", "reports", "team_management", "api_access"]'),
        ('enterprise', 'Enterprise Plan', '["tasks", "reports", "team_management", "api_access", "advanced_analytics", "priority_support"])
        ON CONFLICT (id) DO NOTHING
      `);
      
      logger.info('Database migrations completed successfully');
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  } else {
    logger.info('Demo mode detected - skipping migrations');
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}
