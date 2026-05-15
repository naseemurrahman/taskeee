-- TASKEE canonical project model schema preparation
-- Safe to run repeatedly. This does not remove legacy task_categories behavior.

BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  owner_id uuid NULL,
  manager_id uuid NULL,
  start_date date NULL,
  due_date date NULL,
  created_by uuid NULL,
  updated_by uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager_id uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date date NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(org_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_org_name ON projects(org_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_tasks_org_project ON tasks(org_id, project_id);

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_valid;
ALTER TABLE projects
  ADD CONSTRAINT projects_status_valid
  CHECK (status IN ('active', 'paused', 'completed', 'archived'));

COMMIT;
