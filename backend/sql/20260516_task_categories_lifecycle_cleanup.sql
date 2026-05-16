-- Remove project lifecycle behavior from task_categories after canonical project adoption.
-- Preconditions before running:
--   1. projects table exists and contains all canonical projects.
--   2. tasks.project_id is populated for project-linked tasks.
--   3. application reads project lifecycle from projects.status.
--   4. task_categories is used only for task category/tag metadata.
--
-- This script intentionally preserves task_categories.id/name/color/description
-- and removes only lifecycle-oriented columns/constraints that can make a
-- category look like a project.

BEGIN;

-- Drop constraints that validate category lifecycle state, if present.
ALTER TABLE IF EXISTS task_categories
  DROP CONSTRAINT IF EXISTS task_categories_status_check;

ALTER TABLE IF EXISTS task_categories
  DROP CONSTRAINT IF EXISTS task_categories_status_valid;

-- Drop indexes that were only useful for category lifecycle filtering.
DROP INDEX IF EXISTS idx_task_categories_status;
DROP INDEX IF EXISTS idx_task_categories_is_active;
DROP INDEX IF EXISTS task_categories_status_idx;
DROP INDEX IF EXISTS task_categories_is_active_idx;

-- Remove lifecycle columns from task_categories.
ALTER TABLE IF EXISTS task_categories
  DROP COLUMN IF EXISTS status;

ALTER TABLE IF EXISTS task_categories
  DROP COLUMN IF EXISTS is_active;

COMMIT;
