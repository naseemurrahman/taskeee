-- Rollback lifecycle status check constraints only.
-- This does not undo data normalization from 20260516_status_lifecycle_constraints.sql.

BEGIN;

ALTER TABLE IF EXISTS projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE IF EXISTS tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE IF EXISTS employees
  DROP CONSTRAINT IF EXISTS employees_status_check;

COMMIT;
