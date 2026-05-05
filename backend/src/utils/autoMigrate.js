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

  // ── Migration 021: Stripe-backed subscription fields on organizations ──────
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_plan TEXT`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active'`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_limit INTEGER`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_email TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_orgs_stripe_customer ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_orgs_stripe_subscription ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL`,

  // ── Migration 022: Search performance indexes ──────────────────────────────
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_org_updated ON tasks(org_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON tasks USING gin (description gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_task_categories_name_trgm ON task_categories USING gin (name gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`,

  // ── Migration 023: MFA/2FA support ─────────────────────────────────────────
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_used_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS mfa_challenges (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     challenge_hash TEXT NOT NULL,
     expires_at TIMESTAMPTZ NOT NULL,
     consumed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_challenges_hash ON mfa_challenges(challenge_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id, expires_at DESC)`,
  `CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL,
     used_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_hash ON mfa_recovery_codes(user_id, code_hash)`,

  // ── Migration 024: refresh-token lifecycle columns ─────────────────────────
  `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ`,
  `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
  `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires ON refresh_tokens(user_id, expires_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`,

  // ── Migration 025: notification deduplication + delivery retry metadata ────
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_grouped_at TIMESTAMPTZ`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_recent ON notifications(user_id, dedupe_key, created_at DESC) WHERE dedupe_key IS NOT NULL`,
  `ALTER TABLE notification_delivery_log ADD COLUMN IF NOT EXISTS notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL`,
  `ALTER TABLE notification_delivery_log ADD COLUMN IF NOT EXISTS retry_of UUID REFERENCES notification_delivery_log(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_notif_log_notification ON notification_delivery_log(notification_id, sent_at DESC)`,
];

async function runAutoMigrations() {
  console.log('[migrate] Running auto-migrations...');
  let ok = 0, skip = 0, fail = 0;
  for (const sql of MIGRATIONS) {
    try {
      await query(sql);
      ok++;
    } catch (err) {
      if (err.code === '42P01') { skip++; }
      else { fail++; console.warn('[migrate] Non-fatal:', err.message); }
    }
  }
  console.log(`[migrate] Done: ${ok} applied, ${skip} skipped, ${fail} warnings`);
}

module.exports = { runAutoMigrations };
