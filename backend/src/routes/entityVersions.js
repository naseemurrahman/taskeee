'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const ALLOWED_TYPES = new Set(['task', 'project', 'employee']);

router.get('/:entityType/:entityId', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const entityType = String(req.params.entityType || '').toLowerCase();
    if (!ALLOWED_TYPES.has(entityType)) return res.status(400).json({ error: 'Unsupported entity type' });

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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
