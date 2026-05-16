-- Lifecycle status constraints for canonical project/task/employee governance.
-- Run after project schema prep/backfill and after data cleanup.
-- This script is idempotent and normalizes known legacy/null values before constraints are added.

BEGIN;

-- projects.status
ALTER TABLE IF EXISTS projects
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE projects
   SET status = 'active'
 WHERE status IS NULL OR TRIM(status) = '';

UPDATE projects
   SET status = LOWER(TRIM(status));

UPDATE projects
   SET status = CASE
     WHEN status IN ('inactive', 'hold', 'on_hold') THEN 'paused'
     WHEN status IN ('done', 'closed', 'complete') THEN 'completed'
     WHEN status IN ('deleted', 'removed') THEN 'archived'
     ELSE status
   END;

UPDATE projects
   SET status = 'active'
 WHERE status NOT IN ('active', 'paused', 'completed', 'archived', 'cancelled');

ALTER TABLE IF EXISTS projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE IF EXISTS projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'archived', 'cancelled'));

-- tasks.status
ALTER TABLE IF EXISTS tasks
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending';

UPDATE tasks
   SET status = 'pending'
 WHERE status IS NULL OR TRIM(status) = '';

UPDATE tasks
   SET status = LOWER(TRIM(status));

UPDATE tasks
   SET status = CASE
     WHEN status IN ('todo', 'to_do', 'new', 'open') THEN 'pending'
     WHEN status IN ('doing', 'started', 'working') THEN 'in_progress'
     WHEN status IN ('submitted_for_review', 'review') THEN 'submitted'
     WHEN status IN ('approved') THEN 'manager_approved'
     WHEN status IN ('rejected') THEN 'manager_rejected'
     WHEN status IN ('done', 'closed', 'complete') THEN 'completed'
     WHEN status IN ('hold', 'paused') THEN 'on_hold'
     ELSE status
   END;

UPDATE tasks
   SET status = 'pending'
 WHERE status NOT IN (
   'pending',
   'in_progress',
   'submitted',
   'manager_approved',
   'manager_rejected',
   'completed',
   'overdue',
   'cancelled',
   'on_hold'
 );

ALTER TABLE IF EXISTS tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

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
    'on_hold'
  ));

-- employees.status
ALTER TABLE IF EXISTS employees
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE employees
   SET status = 'active'
 WHERE status IS NULL OR TRIM(status) = '';

UPDATE employees
   SET status = LOWER(TRIM(status));

UPDATE employees
   SET status = CASE
     WHEN status IN ('disabled', 'deactivated') THEN 'inactive'
     WHEN status IN ('fired', 'left', 'resigned', 'deleted') THEN 'terminated'
     WHEN status IN ('leave', 'vacation') THEN 'on_leave'
     ELSE status
   END;

UPDATE employees
   SET status = 'inactive'
 WHERE status NOT IN ('active', 'inactive', 'terminated', 'suspended', 'on_leave');

ALTER TABLE IF EXISTS employees
  DROP CONSTRAINT IF EXISTS employees_status_check;

ALTER TABLE IF EXISTS employees
  ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'inactive', 'terminated', 'suspended', 'on_leave'));

COMMIT;
