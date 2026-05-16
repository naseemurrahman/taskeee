-- Restore optional category status columns if an older deployment still requires them.

BEGIN;

ALTER TABLE IF EXISTS task_categories
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE IF EXISTS task_categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE IF EXISTS task_categories
  DROP CONSTRAINT IF EXISTS task_categories_status_check;

ALTER TABLE IF EXISTS task_categories
  ADD CONSTRAINT task_categories_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'archived', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_task_categories_status
  ON task_categories(status);

CREATE INDEX IF NOT EXISTS idx_task_categories_is_active
  ON task_categories(is_active);

COMMIT;
