-- Search and attachment governance foundation.
-- Adds attachment version metadata, scan status, and searchable indexes for files.

ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS parent_attachment_id UUID NULL;
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS scan_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS scan_result JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NULL;
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE task_photos ADD COLUMN IF NOT EXISTS description TEXT NULL;

CREATE TABLE IF NOT EXISTS attachment_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES task_photos(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  storage_bucket TEXT,
  file_size_bytes BIGINT,
  mime_type TEXT,
  original_filename TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  scan_status TEXT NOT NULL DEFAULT 'pending',
  scan_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attachment_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_attachment_versions_task ON attachment_versions(task_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_attachment_versions_org ON attachment_versions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_photos_scan ON task_photos(scan_status, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_photos_tags ON task_photos USING GIN(tags);

CREATE OR REPLACE FUNCTION seed_attachment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  task_org UUID;
BEGIN
  SELECT org_id INTO task_org FROM tasks WHERE id = NEW.task_id;
  INSERT INTO attachment_versions (
    org_id, task_id, attachment_id, version_no, storage_key, storage_bucket,
    file_size_bytes, mime_type, original_filename, uploaded_by, scan_status, scan_result
  ) VALUES (
    task_org, NEW.task_id, NEW.id, COALESCE(NEW.version_no, 1), NEW.storage_key, NEW.storage_bucket,
    NEW.file_size_bytes, NEW.mime_type, NEW.original_filename, NEW.uploaded_by,
    COALESCE(NEW.scan_status, 'pending'), COALESCE(NEW.scan_result, '{}'::jsonb)
  ) ON CONFLICT (attachment_id, version_no) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_attachment_version ON task_photos;
CREATE TRIGGER trg_seed_attachment_version
  AFTER INSERT ON task_photos
  FOR EACH ROW EXECUTE FUNCTION seed_attachment_version();

CREATE OR REPLACE FUNCTION mark_attachment_scanned(
  p_attachment_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE task_photos
     SET scan_status = p_status,
         scan_result = COALESCE(p_result, '{}'::jsonb),
         scanned_at = NOW()
   WHERE id = p_attachment_id;

  UPDATE attachment_versions
     SET scan_status = p_status,
         scan_result = COALESCE(p_result, '{}'::jsonb)
   WHERE attachment_id = p_attachment_id
     AND version_no = (SELECT version_no FROM task_photos WHERE id = p_attachment_id);
END;
$$;

CREATE OR REPLACE VIEW searchable_attachments AS
SELECT
  tp.id,
  t.org_id,
  tp.task_id,
  tp.uploaded_by,
  tp.original_filename,
  tp.mime_type,
  tp.tags,
  tp.description,
  tp.scan_status,
  tp.created_at,
  t.title AS task_title,
  setweight(to_tsvector('simple', COALESCE(tp.original_filename, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(tp.description, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(array_to_string(tp.tags, ' '), '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(t.title, '')), 'C') AS search_vector
FROM task_photos tp
JOIN tasks t ON t.id = tp.task_id
WHERE COALESCE(t.deleted_at IS NULL, TRUE);
