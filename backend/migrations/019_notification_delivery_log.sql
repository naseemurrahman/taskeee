-- Migration 019: Notification delivery tracking
-- Records every email/WhatsApp send attempt with status and error details

CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  notif_type   VARCHAR(64)  NOT NULL,
  channel      VARCHAR(16)  NOT NULL CHECK (channel IN ('email','whatsapp','socket','push')),
  status       VARCHAR(16)  NOT NULL CHECK (status IN ('sent','skipped','failed')),
  error_msg    TEXT,
  sent_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_user_sent ON notification_delivery_log(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_status     ON notification_delivery_log(status, sent_at DESC);

COMMENT ON TABLE notification_delivery_log IS
  'Tracks every notification delivery attempt. Enables debugging missing email/WhatsApp.';
