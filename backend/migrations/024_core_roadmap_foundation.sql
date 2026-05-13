-- Core roadmap foundation and hardening.
-- Covers remaining checklist gaps that are safe to add at the schema layer:
-- 1) backfill attachment_versions for legacy task_photos,
-- 2) improve entity version actor attribution,
-- 3) add time tracking tables,
-- 4) add knowledge base / SOP tables.

DO $$
BEGIN
  IF to_regclass('public.task_photos') IS NOT NULL
     AND to_regclass('public.tasks') IS NOT NULL
     AND to_regclass('public.attachment_versions') IS NOT NULL THEN
    INSERT INTO attachment_versions (
      org_id, task_id, attachment_id, version_no, storage_key, storage_bucket,
      file_size_bytes, mime_type, original_filename, uploaded_by, scan_status,
      scan_result, created_at
    )
    SELECT
      t.org_id,
      tp.task_id,
      tp.id,
      COALESCE(tp.version_no, 1),
      COALESCE(tp.storage_key, ''),
      tp.storage_bucket,
      tp.file_size_bytes,
      tp.mime_type,
      tp.original_filename,
      tp.uploaded_by,
      COALESCE(tp.scan_status, 'pending'),
      COALESCE(tp.scan_result, '{}'::jsonb),
      COALESCE(tp.created_at, NOW())
    FROM task_photos tp
    JOIN tasks t ON t.id = tp.task_id
    WHERE NOT EXISTS (
      SELECT 1
        FROM attachment_versions av
       WHERE av.attachment_id = tp.id
         AND av.version_no = COALESCE(tp.version_no, 1)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION capture_entity_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entity_type_name TEXT := TG_ARGV[0];
  old_row JSONB := to_jsonb(OLD);
  new_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  org_value UUID := NULL;
  actor_text TEXT := NULL;
  actor_uuid UUID := NULL;
BEGIN
  IF TG_OP = 'UPDATE' AND old_row = new_row THEN
    RETURN NEW;
  END IF;

  IF old_row ? 'org_id' AND NULLIF(old_row ->> 'org_id', '') IS NOT NULL THEN
    org_value := (old_row ->> 'org_id')::UUID;
  END IF;

  actor_text := NULLIF(current_setting('taskee.actor_user_id', true), '');

  IF actor_text IS NULL AND new_row IS NOT NULL THEN
    actor_text := COALESCE(
      NULLIF(new_row ->> 'updated_by', ''),
      NULLIF(new_row ->> 'deleted_by', ''),
      NULLIF(new_row ->> 'restored_by', ''),
      NULLIF(new_row ->> 'created_by', '')
    );
  END IF;

  IF actor_text IS NULL THEN
    actor_text := COALESCE(
      NULLIF(old_row ->> 'updated_by', ''),
      NULLIF(old_row ->> 'deleted_by', ''),
      NULLIF(old_row ->> 'created_by', '')
    );
  END IF;

  IF actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_uuid := actor_text::UUID;
  END IF;

  INSERT INTO entity_versions (
    org_id, entity_type, entity_id, operation, version_no, snapshot,
    changed_by, change_reason
  )
  VALUES (
    org_value,
    entity_type_name,
    OLD.id,
    LOWER(TG_OP),
    next_entity_version_no(entity_type_name, OLD.id),
    old_row,
    actor_uuid,
    current_setting('taskee.change_reason', true)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_org_started ON time_entries(org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_started ON time_entries(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_task_started ON time_entries(task_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_running_timer
  ON time_entries(user_id)
  WHERE stopped_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  visibility TEXT NOT NULL DEFAULT 'org',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (visibility IN ('org', 'management', 'hr', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_org_updated ON knowledge_articles(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(org_id, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tags ON knowledge_articles USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_search ON knowledge_articles USING GIN (
  (
    setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(summary, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(content, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(tags, ' '), '')), 'B')
  )
);
