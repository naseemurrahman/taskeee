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

      // Create organization_members table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS organization_members (
          org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(50) DEFAULT 'member',
          is_active BOOLEAN DEFAULT true,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (org_id, user_id)
        )
      `);

      // Create refresh_tokens table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(64) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create mfa_challenges table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mfa_challenges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          challenge_hash VARCHAR(64) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          consumed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create user_activity_logs table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_activity_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          task_id UUID,
          activity_type VARCHAR(100) NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create email_verification_tokens table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(64) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create password_reset_tokens table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(64) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create tasks table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          status VARCHAR(50) DEFAULT 'pending',
          priority VARCHAR(20) DEFAULT 'medium',
          assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
          assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
          category_id UUID,
          due_date TIMESTAMP,
          completed_at TIMESTAMP,
          submitted_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create task_categories table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          color VARCHAR(20),
          ai_enabled BOOLEAN DEFAULT false,
          ai_threshold DECIMAL(3,2) DEFAULT 0.75,
          ai_model_id VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create task_photos table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_photos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
          storage_key TEXT,
          storage_bucket TEXT,
          file_size_bytes BIGINT,
          mime_type VARCHAR(100),
          original_filename TEXT,
          taken_at TIMESTAMP,
          geo_lat DECIMAL(10,8),
          geo_lng DECIMAL(11,8),
          ai_status VARCHAR(50) DEFAULT 'pending',
          ai_confidence DECIMAL(3,2),
          ai_labels JSONB,
          ai_rejection_reason TEXT,
          reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TIMESTAMP,
          review_note TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create task_timeline table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_timeline (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
          actor_type VARCHAR(50) DEFAULT 'user',
          event_type VARCHAR(100) NOT NULL,
          from_status VARCHAR(50),
          to_status VARCHAR(50),
          note TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create task_comments table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS task_comments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create projects table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(50) DEFAULT 'active',
          start_date DATE,
          end_date DATE,
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create project_tasks table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS project_tasks (
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (project_id, task_id)
        )
      `);

      // Create notifications table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          body TEXT,
          data JSONB DEFAULT '{}',
          read_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`);

      // Insert default subscription plans
      await pool.query(`
        INSERT INTO subscription_plans (id, name, features) VALUES
        ('basic', 'Basic Plan', '["tasks", "reports"]'),
        ('pro', 'Pro Plan', '["tasks", "reports", "team_management", "api_access"]'),
        ('enterprise', 'Enterprise Plan', '["tasks", "reports", "team_management", "api_access", "advanced_analytics", "priority_support"]')
        ON CONFLICT (id) DO NOTHING
      `);
      
      // Safety: ensure columns that may have been added in patches exist
      await pool.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP,
          ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT,
          ADD COLUMN IF NOT EXISTS department VARCHAR(255),
          ADD COLUMN IF NOT EXISTS avatar_url TEXT
      `).catch(() => {});

      await pool.query(`
        ALTER TABLE organizations
          ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `).catch(() => {});

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
