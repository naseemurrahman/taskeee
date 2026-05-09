/**
 * schemaVerify.js — Priority 6: Database/Schema Cleanup
 *
 * Runs at server startup. Verifies all core tables and required columns exist.
 * Does NOT silently adapt to missing schema — logs clear errors and marks
 * the server as degraded so health checks can surface the issue.
 */

const { query } = require('./db');
const logger = require('./logger');

const REQUIRED_TABLES = [
  'organizations', 'users', 'tasks', 'task_timeline',
  'task_photos', 'task_messages', 'projects', 'notifications',
];

const REQUIRED_COLUMNS = {
  tasks: ['id', 'org_id', 'title', 'status', 'assigned_to', 'created_at', 'deleted_at'],
  users: ['id', 'org_id', 'email', 'role', 'is_active', 'created_at'],
  task_timeline: ['id', 'task_id', 'actor_id', 'event_type', 'created_at'],
  organizations: ['id', 'name', 'created_at'],
};

const OPTIONAL_COLUMNS_WARN = {
  tasks: ['started_at', 'submitted_at', 'completed_at', 'rejection_reason', 'parent_task_id'],
  users: ['notification_prefs', 'phone_e164', 'whatsapp_e164'],
};

let _schemaStatus = { verified: false, missingTables: [], missingColumns: [], degraded: false };

async function verifySchema() {
  const missingTables = [];
  const missingColumns = [];
  const warnings = [];

  // Check required tables
  for (const table of REQUIRED_TABLES) {
    try {
      const { rows } = await query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
        [table]
      );
      if (!rows.length) missingTables.push(table);
    } catch (err) {
      missingTables.push(table);
    }
  }

  // Check required columns
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    if (missingTables.includes(table)) continue; // skip if table itself missing
    try {
      const { rows } = await query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const existing = new Set(rows.map(r => r.column_name));
      for (const col of cols) {
        if (!existing.has(col)) missingColumns.push(`${table}.${col}`);
      }
    } catch (_err) {
      // If we can't query information_schema, skip
    }
  }

  // Check optional columns (warn only)
  for (const [table, cols] of Object.entries(OPTIONAL_COLUMNS_WARN)) {
    if (missingTables.includes(table)) continue;
    try {
      const { rows } = await query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const existing = new Set(rows.map(r => r.column_name));
      for (const col of cols) {
        if (!existing.has(col)) warnings.push(`${table}.${col} (optional, run autoMigrate)`);
      }
    } catch (_err) {}
  }

  const degraded = missingTables.length > 0 || missingColumns.length > 0;

  _schemaStatus = {
    verified: true,
    missingTables,
    missingColumns,
    warnings,
    degraded,
    checkedAt: new Date().toISOString(),
  };

  if (missingTables.length > 0) {
    logger.error(`[schema] MISSING TABLES: ${missingTables.join(', ')}`);
    logger.error('[schema] Run migrations: node src/utils/migrate.js');
  }

  if (missingColumns.length > 0) {
    logger.error(`[schema] MISSING COLUMNS: ${missingColumns.join(', ')}`);
  }

  if (warnings.length > 0) {
    logger.warn(`[schema] Missing optional columns (non-fatal): ${warnings.join(', ')}`);
  }

  if (!degraded) {
    logger.info(`[schema] ✓ Schema verified — all required tables and columns present`);
  } else {
    logger.warn(`[schema] ⚠ Server starting in DEGRADED mode — schema gaps detected`);
  }

  return _schemaStatus;
}

function getSchemaStatus() {
  return _schemaStatus;
}

module.exports = { verifySchema, getSchemaStatus };
