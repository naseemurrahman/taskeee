-- Patch migration: add columns that scripts/migrate.js (old runner) never created
-- All statements use IF NOT EXISTS / DO NOTHING so they're safe to run on any DB state.

-- notifications: add is_read column (old runner only had read_at)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;

-- task_categories: add icon and is_active columns (old runner omitted them)
ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- users: add avatar_url if missing (migration 013 added it as TEXT but old runner never ran it)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- users: add mfa columns if missing (migration 006 added them)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_last_used_at TIMESTAMPTZ;

-- users: add email_verified if missing
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- organizations: ensure plan column has correct constraint
-- (scripts/migrate.js may have created it without the check constraint)
DO $$
BEGIN
  -- Normalize any legacy plan values before adding constraint
  UPDATE organizations SET plan = 'pro'
    WHERE lower(trim(coalesce(plan, ''))) IN ('business', 'professional');
  UPDATE organizations SET plan = 'basic'
    WHERE plan IS NULL OR trim(coalesce(plan, '')) = ''
       OR lower(trim(plan)) IN ('starter', 'free');
  UPDATE organizations SET plan = 'basic'
    WHERE plan NOT IN ('basic', 'pro', 'enterprise');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Ensure stripe_subscriptions.updated_at column exists (some deployments may miss it)
DO $$
BEGIN
  ALTER TABLE stripe_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Recreate missing index on notifications if needed
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, is_read, created_at DESC);
