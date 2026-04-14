-- Run manually against PostgreSQL when not using demo mode.
CREATE TABLE IF NOT EXISTS task_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 8000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);

-- Optional contact fields for email / WhatsApp notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_e164 VARCHAR(32);
