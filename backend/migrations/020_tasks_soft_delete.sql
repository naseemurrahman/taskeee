-- Migration 020: Soft delete for tasks + fill migration number gap
-- Tasks can be archived without losing history (timeline, photos, comments)

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by    UUID REFERENCES users(id) ON DELETE SET NULL;

-- Partial index: all existing queries implicitly filter deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_tasks_active
  ON tasks(org_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Notifications table: add delivery columns if not present from 019
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_error   TEXT;

COMMENT ON COLUMN tasks.deleted_at IS 'Soft delete timestamp. NULL = active task.';
COMMENT ON COLUMN tasks.deleted_by IS 'User who soft-deleted the task.';
