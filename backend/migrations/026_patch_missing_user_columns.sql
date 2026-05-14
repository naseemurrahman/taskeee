-- Patch: add columns that the code references but were never in any migration
-- All additions are IF NOT EXISTS so they're safe to run on any DB state

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_enabled          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret_enc       TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_last_used_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temp_password        TEXT,
  ADD COLUMN IF NOT EXISTS temp_password_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avatar_url           TEXT,
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS timezone             TEXT         NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS language             TEXT         NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS theme                TEXT         NOT NULL DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS notification_prefs   JSONB        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by           UUID;

-- Ensure organizations table has all required columns
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS settings   JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Ensure refresh_tokens table exists
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Ensure user_activity_logs table exists
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL,
  user_id       UUID        NOT NULL,
  task_id       UUID,
  activity_type TEXT        NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user ON user_activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_org  ON user_activity_logs(org_id, created_at DESC);

-- Ensure organization_members table exists (used by signup)
CREATE TABLE IF NOT EXISTS organization_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'member',
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID,
  UNIQUE(org_id, user_id)
);
