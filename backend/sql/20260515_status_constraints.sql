-- TASKEE status governance constraints
-- Apply manually or through the deployment SQL migration process.
-- The current JS migration runner is disabled and logs: "use SQL file migrations only".

BEGIN;

-- Normalize common nulls before enforcing constraints.
UPDATE tasks
   SET status = 'pending'
 WHERE status IS NULL;

UPDATE task_categories
   SET status = CASE
     WHEN COALESCE(is_active, TRUE) = TRUE THEN 'active'
     ELSE 'completed'
   END
 WHERE status IS NULL;

UPDATE projects
   SET status = 'active'
 WHERE status IS NULL;

UPDATE employees
   SET status = 'active'
 WHERE status IS NULL;

-- Drop old constraint names if this script is re-run.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_valid;
ALTER TABLE task_categories DROP CONSTRAINT IF EXISTS task_categories_status_valid;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_valid;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_valid;

-- Task workflow statuses used by current backend routes.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_valid
  CHECK (status IN (
    'pending',
    'in_progress',
    'submitted',
    'completed',
    'manager_approved',
    'cancelled',
    'on_hold',
    'blocked'
  ));

-- Project lifecycle statuses.
ALTER TABLE task_categories
  ADD CONSTRAINT task_categories_status_valid
  CHECK (status IN ('active', 'paused', 'completed', 'archived'));

ALTER TABLE projects
  ADD CONSTRAINT projects_status_valid
  CHECK (status IN ('active', 'paused', 'completed', 'archived'));

-- Employee lifecycle statuses.
ALTER TABLE employees
  ADD CONSTRAINT employees_status_valid
  CHECK (status IN ('active', 'inactive', 'terminated', 'suspended', 'on_leave'));

COMMIT;
