-- Entity history snapshots for tasks, projects, and employees.

CREATE TABLE IF NOT EXISTS entity_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  operation TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, entity_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_entity_versions_lookup ON entity_versions(entity_type, entity_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_entity_versions_org_created ON entity_versions(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION next_entity_version_no(p_entity_type TEXT, p_entity_id UUID)
RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT COALESCE(MAX(version_no), 0) + 1 FROM entity_versions WHERE entity_type = p_entity_type AND entity_id = p_entity_id;
$$;

CREATE OR REPLACE FUNCTION capture_entity_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entity_type_name TEXT := TG_ARGV[0];
  org_value UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;

  org_value := OLD.org_id;

  INSERT INTO entity_versions (org_id, entity_type, entity_id, operation, version_no, snapshot, change_reason)
  VALUES (
    org_value,
    entity_type_name,
    OLD.id,
    LOWER(TG_OP),
    next_entity_version_no(entity_type_name, OLD.id),
    to_jsonb(OLD),
    current_setting('taskee.change_reason', true)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_tasks_entity_version ON tasks;
    CREATE TRIGGER trg_tasks_entity_version BEFORE UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION capture_entity_version('task');
  END IF;

  IF to_regclass('public.employees') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_employees_entity_version ON employees;
    CREATE TRIGGER trg_employees_entity_version BEFORE UPDATE OR DELETE ON employees FOR EACH ROW EXECUTE FUNCTION capture_entity_version('employee');
  END IF;

  IF to_regclass('public.task_categories') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_task_categories_entity_version ON task_categories;
    CREATE TRIGGER trg_task_categories_entity_version BEFORE UPDATE OR DELETE ON task_categories FOR EACH ROW EXECUTE FUNCTION capture_entity_version('project');
  END IF;
END $$;
