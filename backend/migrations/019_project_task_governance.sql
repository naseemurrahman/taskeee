-- Project/task governance guardrails.
-- Prevents project completion while active tasks exist and blocks unsafe task
-- completion/deletion when dependencies would be violated.

CREATE TABLE IF NOT EXISTS governance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_overrides_org_created
  ON governance_overrides(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_governance_overrides_entity
  ON governance_overrides(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION active_project_task_count(p_org_id UUID, p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  c INTEGER := 0;
BEGIN
  IF to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::int
    INTO c
    FROM tasks t
   WHERE t.org_id = p_org_id
     AND COALESCE(t.deleted_at IS NULL, TRUE)
     AND COALESCE(t.status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled')
     AND (
       (to_regclass('public.task_categories') IS NOT NULL AND t.category_id = p_project_id)
       OR
       (EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'project_id'
        ) AND t.project_id = p_project_id)
     );

  RETURN COALESCE(c, 0);
END;
$$;

CREATE OR REPLACE FUNCTION enforce_project_completion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER := 0;
  project_status TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  project_status := LOWER(COALESCE(NEW.status, CASE WHEN COALESCE(NEW.is_active, TRUE) THEN 'active' ELSE 'completed' END));

  IF project_status IN ('completed', 'complete', 'closed')
     AND LOWER(COALESCE(OLD.status, 'active')) IS DISTINCT FROM project_status THEN
    active_count := active_project_task_count(NEW.org_id, NEW.id);
    IF active_count > 0 THEN
      RAISE EXCEPTION 'Cannot complete project while % active task(s) exist', active_count
        USING ERRCODE = 'P0001', HINT = 'Complete, cancel, or reassign active tasks before completing the project.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.task_categories') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_task_categories_completion_guard ON task_categories;
    CREATE TRIGGER trg_task_categories_completion_guard
      BEFORE UPDATE ON task_categories
      FOR EACH ROW
      EXECUTE FUNCTION enforce_project_completion_guard();
  END IF;

  IF to_regclass('public.projects') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_projects_completion_guard ON projects;
    CREATE TRIGGER trg_projects_completion_guard
      BEFORE UPDATE ON projects
      FOR EACH ROW
      EXECUTE FUNCTION enforce_project_completion_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION incomplete_blocking_dependency_count(p_task_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  c INTEGER := 0;
BEGIN
  IF to_regclass('public.task_dependencies') IS NULL OR to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::int
    INTO c
    FROM task_dependencies td
    JOIN tasks dep ON dep.id = td.depends_on_task_id
   WHERE td.task_id = p_task_id
     AND COALESCE(td.dependency_type, 'blocks') = 'blocks'
     AND COALESCE(dep.deleted_at IS NULL, TRUE)
     AND COALESCE(dep.status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled');

  RETURN COALESCE(c, 0);
END;
$$;

CREATE OR REPLACE FUNCTION active_dependent_task_count(p_task_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  c INTEGER := 0;
BEGIN
  IF to_regclass('public.task_dependencies') IS NULL OR to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::int
    INTO c
    FROM task_dependencies td
    JOIN tasks dependent ON dependent.id = td.task_id
   WHERE td.depends_on_task_id = p_task_id
     AND COALESCE(td.dependency_type, 'blocks') = 'blocks'
     AND COALESCE(dependent.deleted_at IS NULL, TRUE)
     AND COALESCE(dependent.status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled');

  RETURN COALESCE(c, 0);
END;
$$;

CREATE OR REPLACE FUNCTION enforce_task_dependency_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  blocker_count INTEGER := 0;
  dependent_count INTEGER := 0;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.status, '')) IN ('completed', 'manager_approved')
     AND LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM LOWER(COALESCE(NEW.status, '')) THEN
    blocker_count := incomplete_blocking_dependency_count(NEW.id);
    IF blocker_count > 0 THEN
      RAISE EXCEPTION 'Cannot complete task while % blocking dependency task(s) are incomplete', blocker_count
        USING ERRCODE = 'P0001', HINT = 'Complete blocking dependencies before completing this task.';
    END IF;
  END IF;

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    dependent_count := active_dependent_task_count(NEW.id);
    IF dependent_count > 0 THEN
      RAISE EXCEPTION 'Cannot delete task because % active dependent task(s) still rely on it', dependent_count
        USING ERRCODE = 'P0001', HINT = 'Remove dependencies or complete dependent tasks before deleting this task.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_tasks_dependency_guard ON tasks;
    CREATE TRIGGER trg_tasks_dependency_guard
      BEFORE UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION enforce_task_dependency_guard();
  END IF;
END $$;
