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
