const { query } = require('../utils/db');
const logger = require('../utils/logger');

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({});
  }
}

async function logAudit({
  orgId,
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  metadata = {},
  ip = null,
  userAgent = null,
}) {
  if (!orgId || !action || !entityType) return;
  try {
    await query(
      `INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, actorUserId, String(action), String(entityType), entityId, safeJson(metadata), ip, userAgent]
    );
  } catch (err) {
    logger.warn(`Audit log failed: ${err.message}`);
  }
}

module.exports = { logAudit };

