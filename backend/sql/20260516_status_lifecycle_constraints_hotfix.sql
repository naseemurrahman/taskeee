-- Hotfix for 20260516_status_lifecycle_constraints.sql.
-- Keeps AI workflow task statuses valid and replaces older *_status_valid constraints.

BEGIN;

ALTER TABLE IF EXISTS projects
  DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE IF EXISTS projects
  DROP CONSTRAINT IF EXISTS projects_status_valid;
ALTER TABLE IF EXISTS projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'archived', 'cancelled'));

ALTER TABLE IF EXISTS tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE IF EXISTS tasks
  DROP CONSTRAINT IF EXISTS tasks_status_valid;
ALTER TABLE IF EXISTS tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'pending',
    'in_progress',
    'submitted',
    'manager_approved',
    'manager_rejected',
    'completed',
    'overdue',
    'cancelled',
    'on_hold',
    'ai_reviewing',
    'ai_approved',
    'ai_rejected'
  ));

ALTER TABLE IF EXISTS employees
  DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE IF EXISTS employees
  DROP CONSTRAINT IF EXISTS employees_status_valid;
ALTER TABLE IF EXISTS employees
  ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'inactive', 'terminated', 'suspended', 'on_leave'));

COMMIT;
