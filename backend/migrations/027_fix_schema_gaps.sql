-- Migration 027: Fix schema gaps in fresh database
-- 1. Add 'status' column to task_categories (projects use this for paused/completed)
-- 2. Add 'on_hold' and other statuses to tasks.status CHECK constraint
-- 3. Fix uuid_generate_v4() → gen_random_uuid() dependency
-- 4. Add missing columns to tasks and task_categories

-- Add status to task_categories if missing
ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived'));

ALTER TABLE task_categories
  ADD COLUMN IF NOT EXISTS color VARCHAR(20);

-- Drop and recreate the task status constraint to include on_hold
-- First check if the constraint exists, then alter it safely
DO $$
BEGIN
  -- Drop old constraint if exists
  ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
  -- Add new constraint with on_hold
  ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
    CHECK (status IN (
      'pending','in_progress','submitted','ai_reviewing',
      'ai_approved','ai_rejected','manager_approved',
      'manager_rejected','completed','overdue','cancelled','on_hold'
    ));
EXCEPTION WHEN OTHERS THEN
  -- If tasks table doesn't have the column yet, ignore
  NULL;
END $$;

-- Add missing task columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_hours FLOAT,
  ADD COLUMN IF NOT EXISTS actual_hours FLOAT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add AI columns to tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ai_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS ai_confidence FLOAT,
  ADD COLUMN IF NOT EXISTS ai_notes TEXT,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at TIMESTAMPTZ;

-- Add assigned_by to tasks if missing
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id);

-- Ensure task_photos (attachments) table exists
CREATE TABLE IF NOT EXISTS task_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  original_filename TEXT,
  storage_key     TEXT,
  storage_bucket  TEXT,
  file_size_bytes BIGINT,
  mime_type       TEXT,
  tags            TEXT[] DEFAULT '{}',
  description     TEXT,
  scan_status     VARCHAR(20) DEFAULT 'pending',
  scan_result     JSONB DEFAULT '{}',
  version_no      INT DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_photos_task ON task_photos(task_id);
CREATE INDEX IF NOT EXISTS idx_task_photos_org  ON task_photos(org_id);

-- Ensure task_messages exists
CREATE TABLE IF NOT EXISTS task_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  message_type VARCHAR(30) DEFAULT 'comment',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);

-- Ensure task_timeline exists
CREATE TABLE IF NOT EXISTS task_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id),
  event_type  TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_timeline_task ON task_timeline(task_id);

-- Ensure notifications table exists
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Fix task_categories to use gen_random_uuid() if needed
-- (uuid_generate_v4 requires uuid-ossp extension which Railway may not have)
ALTER TABLE task_categories
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE tasks
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE organizations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
