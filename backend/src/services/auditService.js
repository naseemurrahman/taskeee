'use strict';

const { query } = require('../utils/db');
const logger = require('../utils/logger');

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { return JSON.stringify({}); }
}

async function ensureAuditSchema() {
  await query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)`);
}

function pickIp(req) {
  return req?.headers?.['x-forwarded-for']?.split(',')?.[0]?.trim() || req?.ip || null;
}

async function logAudit({ orgId, actorUserId = null, action, entityType, entityId = null, metadata = {}, ip = null, userAgent = null }) {
  if (!orgId || !action || !entityType) return;
  try {
    await ensureAuditSchema();
    await query(
      `INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7, '')::inet,$8)`,
      [orgId, actorUserId, String(action), String(entityType), entityId ? String(entityId) : null, safeJson(metadata), ip || '', userAgent]
    );
  } catch (err) {
    logger.warn(`Audit log failed: ${err.message}`);
  }
}

async function logAuditEvent({ req = null, orgId = null, actorUserId = null, action, entityType, entityId = null, metadata = {} }) {
  return logAudit({
    orgId: orgId || req?.user?.org_id || req?.user?.orgId,
    actorUserId: actorUserId || req?.user?.id || null,
    action,
    entityType,
    entityId,
    metadata,
    ip: pickIp(req),
    userAgent: req?.headers?.['user-agent'] || null,
  });
}

module.exports = { ensureAuditSchema, logAudit, logAuditEvent };
