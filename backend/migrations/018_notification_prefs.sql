-- Migration 018: User notification preferences and contact details
-- Adds columns needed for real email/WhatsApp delivery and per-user opt-in/out

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_e164      VARCHAR(32),
  ADD COLUMN IF NOT EXISTS whatsapp_e164   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{
    "task_assigned":    true,
    "task_approved":    true,
    "task_comment":     true,
    "task_file":        true,
    "task_overdue":     true,
    "reports_weekly":   false,
    "channels": {
      "email":     true,
      "whatsapp":  false
    }
  }'::jsonb;

-- Index for looking up users by phone (WhatsApp delivery)
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_e164 ON users(whatsapp_e164) WHERE whatsapp_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone_e164    ON users(phone_e164)    WHERE phone_e164 IS NOT NULL;

COMMENT ON COLUMN users.notification_prefs IS
  'Per-user notification opt-in/out. channels.email and channels.whatsapp control delivery channel.';
