-- TASKEE canonical project backfill from legacy task_categories
-- Run after 20260515_project_schema_prep.sql.
-- Safe to run repeatedly.

BEGIN;

INSERT INTO projects (id, org_id, name, description, status, created_at, updated_at, metadata)
SELECT tc.id,
       tc.org_id,
       tc.name,
       tc.description,
       COALESCE(tc.status, CASE WHEN COALESCE(tc.is_active, TRUE) THEN 'active' ELSE 'completed' END),
       COALESCE(tc.created_at, NOW()),
       NOW(),
       jsonb_build_object('legacy_task_category_id', tc.id, 'backfilled_from', 'task_categories')
  FROM task_categories tc
 WHERE NOT EXISTS (
       SELECT 1 FROM projects p WHERE p.id = tc.id AND p.org_id = tc.org_id
 );

UPDATE tasks t
   SET project_id = t.category_id
 WHERE t.project_id IS NULL
   AND t.category_id IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM projects p WHERE p.id = t.category_id AND p.org_id = t.org_id
   );

COMMIT;
