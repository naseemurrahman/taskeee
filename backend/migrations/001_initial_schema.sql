-- TaskFlow Pro - Initial Schema
-- Best practice: use UUIDs, soft deletes, audit timestamps everywhere

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- ORGANIZATIONS (multi-tenant)
-- ─────────────────────────────────────────────
CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(100) UNIQUE NOT NULL,
  settings      JSONB DEFAULT '{}',
  plan          VARCHAR(50) DEFAULT 'starter' CHECK (plan IN ('starter','business','enterprise')),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- USERS & HIERARCHY
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            VARCHAR(50) NOT NULL CHECK (role IN ('employee','supervisor','manager','director','admin')),
  manager_id      UUID REFERENCES users(id) ON DELETE SET NULL,  -- direct parent in hierarchy
  department      VARCHAR(100),
  employee_code   VARCHAR(50),
  avatar_url      VARCHAR(500),
  is_active       BOOLEAN DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Index for fast hierarchy traversal
CREATE INDEX idx_users_manager ON users(manager_id);
CREATE INDEX idx_users_org ON users(org_id);

-- Recursive CTE helper: get all reports under a manager
-- Usage: WITH RECURSIVE subordinates AS (SELECT * FROM get_subordinates($manager_id))
CREATE OR REPLACE FUNCTION get_subordinate_ids(p_manager_id UUID)
RETURNS TABLE(user_id UUID, depth INT) AS $$
  WITH RECURSIVE tree AS (
    SELECT id AS user_id, 1 AS depth
    FROM users WHERE manager_id = p_manager_id
    UNION ALL
    SELECT u.id, t.depth + 1
    FROM users u JOIN tree t ON u.manager_id = t.user_id
  )
  SELECT * FROM tree;
$$ LANGUAGE SQL;

-- ─────────────────────────────────────────────
-- TASK CATEGORIES
-- ─────────────────────────────────────────────
CREATE TABLE task_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  -- AI model config for this category
  ai_model_id VARCHAR(100),   -- which trained model to use
  ai_threshold FLOAT DEFAULT 0.75, -- confidence threshold for auto-approve
  icon        VARCHAR(50),
  color       VARCHAR(7),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────────
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  category_id     UUID REFERENCES task_categories(id),
  assigned_to     UUID NOT NULL REFERENCES users(id),
  assigned_by     UUID NOT NULL REFERENCES users(id),
  status          VARCHAR(50) DEFAULT 'pending' CHECK (
                    status IN ('pending','in_progress','submitted','ai_reviewing',
                               'ai_approved','ai_rejected','manager_approved',
                               'manager_rejected','completed','overdue','cancelled')
                  ),
  priority        VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  due_date        TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  location        VARCHAR(500),
  geo_lat         DECIMAL(10,8),
  geo_lng         DECIMAL(11,8),
  notes           TEXT,
  rejection_reason TEXT,
  recurrence      JSONB,  -- { type: 'daily'|'weekly', interval: 1, ends_at: ... }
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_org_status ON tasks(org_id, status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by);

-- ─────────────────────────────────────────────
-- TASK TIMELINE (audit trail for every status change)
-- ─────────────────────────────────────────────
CREATE TABLE task_timeline (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id),
  actor_type  VARCHAR(20) CHECK (actor_type IN ('user','ai_system','system')),
  event_type  VARCHAR(100) NOT NULL,
  from_status VARCHAR(50),
  to_status   VARCHAR(50),
  note        TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeline_task ON task_timeline(task_id, created_at);

-- ─────────────────────────────────────────────
-- TASK PHOTOS (submissions for AI review)
-- ─────────────────────────────────────────────
CREATE TABLE task_photos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id           UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by       UUID NOT NULL REFERENCES users(id),
  storage_key       VARCHAR(500) NOT NULL,  -- S3/GCS object key
  storage_bucket    VARCHAR(100) NOT NULL,
  file_size_bytes   INTEGER,
  mime_type         VARCHAR(50) DEFAULT 'image/jpeg',
  original_filename VARCHAR(255),
  -- AI result
  ai_status         VARCHAR(30) DEFAULT 'pending' CHECK (
                      ai_status IN ('pending','processing','approved','rejected','manual_review','skipped')
                    ),
  ai_confidence     FLOAT,    -- 0.0 - 1.0
  ai_model_version  VARCHAR(50),
  ai_labels         JSONB,    -- raw model output labels
  ai_result_at      TIMESTAMPTZ,
  ai_rejection_reason VARCHAR(500),
  -- Manual override
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  -- Metadata
  taken_at          TIMESTAMPTZ,
  geo_lat           DECIMAL(10,8),
  geo_lng           DECIMAL(11,8),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photos_task ON task_photos(task_id);
CREATE INDEX idx_photos_ai_status ON task_photos(ai_status);

-- ─────────────────────────────────────────────
-- REPORTS (generated + scheduled)
-- ─────────────────────────────────────────────
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id),
  generated_for UUID NOT NULL REFERENCES users(id),  -- the recipient
  report_type   VARCHAR(50) CHECK (report_type IN ('daily','weekly','monthly','on_demand','event')),
  scope_type    VARCHAR(30) CHECK (scope_type IN ('personal','team','department','org')),
  period_start  TIMESTAMPTZ,
  period_end    TIMESTAMPTZ,
  data          JSONB NOT NULL DEFAULT '{}',  -- full report payload
  email_sent    BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_user ON reports(generated_for, created_at DESC);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(100) NOT NULL,
  title       VARCHAR(255),
  body        TEXT,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ─────────────────────────────────────────────
-- AUTH TOKENS (refresh token store)
-- ─────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  device_info VARCHAR(500),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TRIGGERS: auto-update updated_at
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- SEED: default task categories
-- ─────────────────────────────────────────────
-- (run per org after creation)
-- INSERT INTO task_categories (org_id, name, ai_threshold) VALUES ($1, 'Maintenance', 0.80);
