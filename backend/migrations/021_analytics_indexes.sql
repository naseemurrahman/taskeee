-- Analytics query performance indexes
-- Keep this migration schema-compatible with older production databases.

CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks (org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_created_at ON tasks (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_org_due_date ON tasks (org_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assigned_to ON tasks (org_id, assigned_to);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'project_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_org_project_id ON tasks (org_id, project_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'completed_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_org_completed_at ON tasks (org_id, completed_at);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'ai_validation_status'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_org_ai_validation ON tasks (org_id, ai_validation_status);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'ai_confidence_score'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_org_ai_confidence ON tasks (org_id, ai_confidence_score);
  END IF;
END $$;
