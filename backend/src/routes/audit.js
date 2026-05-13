'use strict';

const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireRole, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');

const VERSION_ENTITY_TYPES = new Set(['task', 'project', 'employee']);
const ENTITY_TABLES = {
  task: { table: 'tasks', allowedFields: ['title', 'description', 'status', 'priority', 'assigned_to', 'assigned_by', 'category_id', 'due_date', 'metadata'] },
  project: { table: 'task_categories', allowedFields: ['name', 'description', 'color', 'is_active', 'status'] },
  employee: { table: 'employees', allowedFields: ['user_id', 'full_name', 'work_email', 'title', 'department', 'manager_id', 'status', 'employment_type', 'start_date', 'end_date'] },
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function getTableColumns(tableName) {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(rows.map(r => r.column_name));
}

router.get('/versions/:entityType/:entityId', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const entityType = String(req.params.entityType || '').toLowerCase();
    if (!VERSION_ENTITY_TYPES.has(entityType)) return res.status(400).json({ error: 'Unsupported entity type' });
    if (!isUuid(req.params.entityId)) return res.status(400).json({ error: 'Invalid entity id' });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const { rows } = await query(
      `SELECT ev.id, ev.entity_type, ev.entity_id, ev.operation, ev.version_no,
              ev.snapshot, ev.change_reason, ev.created_at,
              u.full_name AS changed_by_name, u.email AS changed_by_email
         FROM entity_versions ev
         LEFT JOIN users u ON u.id = ev.changed_by
        WHERE ev.org_id = $1
          AND ev.entity_type = $2
          AND ev.entity_id = $3::uuid
        ORDER BY ev.version_no DESC
        LIMIT $4`,
      [orgId, entityType, req.params.entityId, limit]
    );

    res.json({ versions: rows });
  } catch (err) { next(err); }
});

router.post('/versions/:entityType/:entityId/rollback/:versionNo', authenticate, requireAnyRole('director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const entityType = String(req.params.entityType || '').toLowerCase();
    const config = ENTITY_TABLES[entityType];
    if (!config) return res.status(400).json({ error: 'Unsupported entity type' });
    if (!isUuid(req.params.entityId)) return res.status(400).json({ error: 'Invalid entity id' });
    const versionNo = parseInt(String(req.params.versionNo || ''), 10);
    if (!Number.isInteger(versionNo) || versionNo < 1) return res.status(400).json({ error: 'Invalid version number' });

    const reason = String(req.body?.reason || req.body?.rollback_reason || '').trim();
    if (reason.length < 8) return res.status(400).json({ error: 'Rollback reason is required and must be at least 8 characters.' });

    const { rows: versionRows } = await query(
      `SELECT * FROM entity_versions
        WHERE org_id = $1 AND entity_type = $2 AND entity_id = $3::uuid AND version_no = $4
        LIMIT 1`,
      [orgId, entityType, req.params.entityId, versionNo]
    );
    const version = versionRows[0];
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const snapshot = typeof version.snapshot === 'object' ? version.snapshot : JSON.parse(version.snapshot || '{}');
    const columns = await getTableColumns(config.table);
    const allowedFields = config.allowedFields.filter(field => columns.has(field) && Object.prototype.hasOwnProperty.call(snapshot, field));
    if (!allowedFields.length) return res.status(400).json({ error: 'Selected version has no rollback-safe fields for this schema.' });

    const restored = await withTransaction(async (client) => {
      await client.query(`SELECT set_config('taskee.actor_user_id', $1, true)`, [req.user.id]);
      await client.query(`SELECT set_config('taskee.change_reason', $1, true)`, [`rollback:${reason}`]);

      const values = [];
      const sets = [];
      for (const field of allowedFields) {
        values.push(snapshot[field] == null ? null : snapshot[field]);
        sets.push(`${field} = $${values.length}`);
      }
      if (columns.has('updated_by')) { values.push(req.user.id); sets.push(`updated_by = $${values.length}`); }
      if (columns.has('updated_at')) { sets.push(`updated_at = NOW()`); }
      values.push(orgId, req.params.entityId);
      const { rows } = await client.query(
        `UPDATE ${config.table}
            SET ${sets.join(', ')}
          WHERE org_id = $${values.length - 1}
            AND id = $${values.length}
          RETURNING *`,
        values
      );
      return rows[0] || null;
    });

    if (!restored) return res.status(404).json({ error: 'Entity not found' });
    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: `${entityType}.rollback`,
      entityType,
      entityId: req.params.entityId,
      metadata: { versionNo, reason, fields: allowedFields },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ restored, versionNo, fields: allowedFields });
  } catch (err) { next(err); }
});

/** Security / configuration audit trail (audit_logs). Distinct from user activity on Logs. */
router.get('/', authenticate, requireRole('supervisor'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    const days = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 365);
    const actionQ = String(req.query.action || '').trim();
    const entityQ = String(req.query.entity || '').trim();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 300);

    let sql = `
      SELECT a.id,
             a.actor_user_id,
             a.action,
             a.entity_type,
             a.entity_id,
             a.metadata,
             a.ip::text AS ip,
             a.user_agent,
             a.created_at,
             u.full_name AS actor_name,
             u.role AS actor_role
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.org_id = $1
        AND a.created_at >= NOW() - ($2::int * INTERVAL '1 day')
    `;
    const params = [orgId, days];
    let p = 3;

    if (actionQ) {
      sql += ` AND a.action ILIKE $${p++}`;
      params.push(`%${actionQ}%`);
    }
    if (entityQ) {
      sql += ` AND a.entity_type ILIKE $${p++}`;
      params.push(`%${entityQ}%`);
    }

    sql += ` ORDER BY a.created_at DESC LIMIT $${p}`;
    params.push(limit);

    const { rows } = await query(sql, params);
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
