'use strict';
/**
 * Auto-migration: runs on server start, safely adds any missing columns
 * to the live DB. Each migration is idempotent using IF NOT EXISTS.
 */
const { query } = require('./db');

const MIGRATIONS = [
  // task_timeline — add all columns that may be missing
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS actor_type TEXT DEFAULT 'user'`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'status_changed'`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS from_status TEXT`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS to_status TEXT`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS note TEXT`,
  `ALTER TABLE task_timeline ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`,
  // tasks — add columns that may be missing
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_flow JSONB DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`,

  // ── Migration 018: User notification prefs + contact channels ──────────────
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(32)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_e164 VARCHAR(32)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{"task_assigned":true,"task_approved":true,"task_comment":true,"task_file":true,"task_overdue":true,"reports_weekly":false,"channels":{"email":true,"whatsapp":false}}'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_users_whatsapp_e164 ON users(whatsapp_e164) WHERE whatsapp_e164 IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_users_phone_e164    ON users(phone_e164)    WHERE phone_e164 IS NOT NULL`,

  // ── Migration 019: Notification delivery log ──────────────────────────────
  `CREATE TABLE IF NOT EXISTS notification_delivery_log (
     id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
     notif_type VARCHAR(64)  NOT NULL,
     channel    VARCHAR(16)  NOT NULL,
     status     VARCHAR(16)  NOT NULL,
     error_msg  TEXT,
     sent_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_log_user_sent ON notification_delivery_log(user_id, sent_at DESC)`,

  // ── Migration 020: Task soft delete + notification delivery columns ────────
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent    BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_error TEXT`,
];

async function runAutoMigrations() {
  console.log('[migrate] Running auto-migrations...');
  let ok = 0, skip = 0, fail = 0;
  for (const sql of MIGRATIONS) {
    try {
      await query(sql);
      ok++;
    } catch (err) {
      // Table doesn't exist yet or other non-critical error
      if (err.code === '42P01') { skip++; } // table not found — skip
      else { fail++; console.warn('[migrate] Non-fatal:', err.message); }
    }
  }
  console.log(`[migrate] Done: ${ok} applied, ${skip} skipped, ${fail} warnings`);
}

module.exports = { runAutoMigrations };
