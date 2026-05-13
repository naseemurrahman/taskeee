'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireRole, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const VERSION_ENTITY_TYPES = new Set(['task', 'project', 'employee']);

router.get('/versions/:entityType/:entityId', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const entityType = String(req.params.entityType || '').toLowerCase();
    if (!VERSION_ENTITY_TYPES.has(entityType)) return res.status(400).json({ error: 'Unsupported entity type' });

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
