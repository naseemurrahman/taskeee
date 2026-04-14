'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

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
