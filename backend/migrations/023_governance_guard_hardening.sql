-- Governance guard hardening.
--
-- This migration replaces the initial project/task governance trigger functions
-- with schema-tolerant versions. The original guard assumed every deployment had
-- tasks.project_id and task_categories.status. Some production schemas only have
-- tasks.category_id and task_categories.is_active, so static references could
-- fail at trigger runtime. These replacements only reference optional columns via
-- dynamic SQL after confirming the columns exist.

CREATE OR REPLACE FUNCTION active_project_task_count(p_org_id UUID, p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  c INTEGER := 0;
  has_category_id BOOLEAN := FALSE;
  has_project_id BOOLEAN := FALSE;
  has_project_tasks BOOLEAN := FALSE;
  has_deleted_at BOOLEAN := FALSE;
  has_status BOOLEAN := FALSE;
  relation_predicates TEXT[] := ARRAY[]::TEXT[];
  sql TEXT;
BEGIN
  IF to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'category_id'
  ) INTO has_category_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'project_id'
  ) INTO has_project_id;

  SELECT to_regclass('public.project_tasks') IS NOT NULL INTO has_project_tasks;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'deleted_at'
  ) INTO has_deleted_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'status'
  ) INTO has_status;

  IF has_category_id THEN
    relation_predicates := relation_predicates || 't.category_id = $2';
  END IF;

  IF has_project_id THEN
    relation_predicates := relation_predicates || 't.project_id = $2';
  END IF;

  IF has_project_tasks THEN
    relation_predicates := relation_predicates || 'EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id = $2)';
  END IF;

  IF array_length(relation_predicates, 1) IS NULL THEN
    RETURN 0;
  END IF;

  sql := 'SELECT COUNT(DISTINCT t.id)::int FROM tasks t WHERE t.org_id = $1';

  IF has_deleted_at THEN
    sql := sql || ' AND t.deleted_at IS NULL';
  END IF;

  IF has_status THEN
    sql := sql || ' AND COALESCE(t.status, ''pending'') NOT IN (''completed'', ''manager_approved'', ''cancelled'')';
  END IF;

  sql := sql || ' AND (' || array_to_string(relation_predicates, ' OR ') || ')';

  EXECUTE sql INTO c USING p_org_id, p_project_id;
  RETURN COALESCE(c, 0);
END;
$$;

CREATE OR REPLACE FUNCTION enforce_project_completion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER := 0;
  new_row JSONB := to_jsonb(NEW);
  old_row JSONB := to_jsonb(OLD);
  new_status TEXT;
  old_status TEXT;
  org_uuid UUID;
  entity_uuid UUID;
  has_recent_override BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF new_row ? 'status' THEN
    new_status := LOWER(COALESCE(new_row ->> 'status', 'active'));
  ELSE
    new_status := CASE
      WHEN COALESCE((new_row ->> 'is_active')::BOOLEAN, TRUE) THEN 'active'
      ELSE 'completed'
    END;
  END IF;

  IF old_row ? 'status' THEN
    old_status := LOWER(COALESCE(old_row ->> 'status', 'active'));
  ELSE
    old_status := CASE
      WHEN COALESCE((old_row ->> 'is_active')::BOOLEAN, TRUE) THEN 'active'
      ELSE 'completed'
    END;
  END IF;

  IF new_status IN ('completed', 'complete', 'closed')
     AND old_status IS DISTINCT FROM new_status THEN
    org_uuid := (new_row ->> 'org_id')::UUID;
    entity_uuid := (new_row ->> 'id')::UUID;
    active_count := active_project_task_count(org_uuid, entity_uuid);

    IF active_count > 0 THEN
      IF to_regclass('public.governance_overrides') IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
            FROM governance_overrides go
           WHERE go.org_id = org_uuid
             AND go.entity_id = entity_uuid
             AND go.entity_type IN ('project', TG_TABLE_NAME)
             AND go.action IN ('project.complete.override', 'project_completion.override')
             AND go.created_at >= NOW() - INTERVAL '10 minutes'
        ) INTO has_recent_override;
      END IF;

      IF NOT has_recent_override THEN
        RAISE EXCEPTION 'Cannot complete project while % active task(s) exist', active_count
          USING ERRCODE = 'P0001', HINT = 'Complete, cancel, or reassign active tasks before completing the project.';
      END IF;
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
  depends_col TEXT;
  has_dependency_type BOOLEAN := FALSE;
  has_deleted_at BOOLEAN := FALSE;
  has_status BOOLEAN := FALSE;
  sql TEXT;
BEGIN
  IF to_regclass('public.task_dependencies') IS NULL OR to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'depends_on_task_id') THEN 'depends_on_task_id'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'depends_on_id') THEN 'depends_on_id'
    ELSE NULL
  END INTO depends_col;

  IF depends_col IS NULL THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'dependency_type') INTO has_dependency_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'deleted_at') INTO has_deleted_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'status') INTO has_status;

  sql := format('SELECT COUNT(*)::int FROM task_dependencies td JOIN tasks dep ON dep.id = td.%I WHERE td.task_id = $1', depends_col);

  IF has_dependency_type THEN
    sql := sql || ' AND COALESCE(td.dependency_type, ''blocks'') = ''blocks''';
  END IF;

  IF has_deleted_at THEN
    sql := sql || ' AND dep.deleted_at IS NULL';
  END IF;

  IF has_status THEN
    sql := sql || ' AND COALESCE(dep.status, ''pending'') NOT IN (''completed'', ''manager_approved'', ''cancelled'')';
  END IF;

  EXECUTE sql INTO c USING p_task_id;
  RETURN COALESCE(c, 0);
END;
$$;

CREATE OR REPLACE FUNCTION active_dependent_task_count(p_task_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  c INTEGER := 0;
  depends_col TEXT;
  has_dependency_type BOOLEAN := FALSE;
  has_deleted_at BOOLEAN := FALSE;
  has_status BOOLEAN := FALSE;
  sql TEXT;
BEGIN
  IF to_regclass('public.task_dependencies') IS NULL OR to_regclass('public.tasks') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'depends_on_task_id') THEN 'depends_on_task_id'
    WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'depends_on_id') THEN 'depends_on_id'
    ELSE NULL
  END INTO depends_col;

  IF depends_col IS NULL THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_dependencies' AND column_name = 'dependency_type') INTO has_dependency_type;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'deleted_at') INTO has_deleted_at;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'status') INTO has_status;

  sql := format('SELECT COUNT(*)::int FROM task_dependencies td JOIN tasks dependent ON dependent.id = td.task_id WHERE td.%I = $1', depends_col);

  IF has_dependency_type THEN
    sql := sql || ' AND COALESCE(td.dependency_type, ''blocks'') = ''blocks''';
  END IF;

  IF has_deleted_at THEN
    sql := sql || ' AND dependent.deleted_at IS NULL';
  END IF;

  IF has_status THEN
    sql := sql || ' AND COALESCE(dependent.status, ''pending'') NOT IN (''completed'', ''manager_approved'', ''cancelled'')';
  END IF;

  EXECUTE sql INTO c USING p_task_id;
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
  new_row JSONB := to_jsonb(NEW);
  old_row JSONB := to_jsonb(OLD);
  new_status TEXT := LOWER(COALESCE(new_row ->> 'status', ''));
  old_status TEXT := LOWER(COALESCE(old_row ->> 'status', ''));
  new_deleted_at TEXT := new_row ->> 'deleted_at';
  old_deleted_at TEXT := old_row ->> 'deleted_at';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF new_status IN ('completed', 'manager_approved')
     AND old_status IS DISTINCT FROM new_status THEN
    blocker_count := incomplete_blocking_dependency_count(NEW.id);
    IF blocker_count > 0 THEN
      RAISE EXCEPTION 'Cannot complete task while % blocking dependency task(s) are incomplete', blocker_count
        USING ERRCODE = 'P0001', HINT = 'Complete blocking dependencies before completing this task.';
    END IF;
  END IF;

  IF new_deleted_at IS NOT NULL AND old_deleted_at IS NULL THEN
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
