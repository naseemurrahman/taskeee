# Project Model Consolidation Plan

TASKEE currently supports two project-like storage models:

- `task_categories`, historically used as task categories and also treated as projects in several routes.
- `projects`, a canonical project table when present in newer schemas.

The backend currently contains compatibility logic that detects which table exists and maps both models into a common project response. This preserves production behavior but increases long-term complexity.

## Target model

Use `projects` as the canonical project lifecycle entity.

`task_categories` should become only a categorization/tagging concept. It should not own project lifecycle state such as `paused`, `completed`, or `archived`.

## Canonical project fields

The canonical `projects` table should support at least:

- `id`
- `org_id`
- `name`
- `description`
- `status`
- `owner_id`
- `manager_id`
- `start_date`
- `due_date`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`
- `metadata`

Recommended project statuses:

- `active`
- `paused`
- `completed`
- `archived`

## Task relationship

Tasks should reference canonical projects through:

- `tasks.project_id`

If task category support remains useful, it should be separate:

- `tasks.category_id`

Do not overload `category_id` as project ownership after migration.

## Migration phases

### Phase 1: Compatibility and observability

Status: mostly implemented.

- Backend reads both `task_categories` and `projects`.
- Project status governance handles both schemas.
- SQL status constraints are documented in `backend/sql/20260515_status_constraints.sql`.
- Audit review UI exists for project completion overrides.

### Phase 2: Schema preparation

Add missing columns to `projects` without changing runtime reads:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager_id uuid NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date date NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date date NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid NULL;
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_project ON tasks(org_id, project_id);
```

### Phase 3: Data backfill

For every `task_categories` row currently used as a project, create a matching `projects` row.

Backfill strategy:

```sql
INSERT INTO projects (id, org_id, name, description, status, created_at, metadata)
SELECT id, org_id, name, description, COALESCE(status, CASE WHEN is_active THEN 'active' ELSE 'completed' END), created_at,
       jsonb_build_object('legacy_task_category_id', id)
  FROM task_categories
 WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = task_categories.id);
```

Then backfill task relationship:

```sql
UPDATE tasks
   SET project_id = category_id
 WHERE project_id IS NULL
   AND category_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.category_id AND p.org_id = tasks.org_id);
```

### Phase 4: Dual-write window

For one release window:

- New project writes go to `projects`.
- If legacy UI still reads `task_categories`, write a compatibility category row only when needed.
- Project status changes update `projects.status` first.
- `task_categories.status` should be considered derived compatibility state.

### Phase 5: Runtime read switch

Change project list/detail/status routes to prefer `projects` unconditionally when table and rows exist.

Compatibility fallback to `task_categories` can stay temporarily for old tenants without backfill.

### Phase 6: Deprecate legacy project behavior

After confirming all tenants have `tasks.project_id` populated:

- Stop treating `task_categories` as projects.
- Remove project lifecycle status updates from `task_categories`.
- Keep categories only for grouping/filtering.

## Risks

- Some existing task records may use `category_id` only and have no `project_id`.
- Some UI language may still call categories "projects".
- Audit/version rollback routes currently map project versions to `task_categories` in some areas.
- Existing reports may count task categories as projects.

## Required follow-up implementation PRs

1. Add schema-preparation SQL file for project canonical columns.
2. Add backfill SQL file from `task_categories` to `projects`.
3. Update backend project reads to prefer `projects` after backfill.
4. Update task creation/edit forms to write `project_id` separately from `category_id`.
5. Update reports/analytics to use `projects` for project lifecycle metrics.
6. Remove lifecycle behavior from `task_categories` after adoption.

## Acceptance criteria

The consolidation is complete when:

- All active tasks have canonical `project_id` where they belong to a project.
- Project lifecycle operations mutate `projects.status` only.
- `task_categories` can be deleted/renamed without changing project lifecycle state.
- Project tabs and override audit review use `projects` as source of truth.
- No route depends on `task_categories.is_active` to determine project completion.
