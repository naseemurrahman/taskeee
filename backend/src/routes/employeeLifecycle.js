'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { orgIdForSessionUser } = require('../utils/orgContext');

router.post('/employees/:id/terminate', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const reason = String(req.body?.reason || '').trim() || null;
    const effectiveDate = req.body?.effectiveDate || req.body?.effective_date || null;
    const reassignTo = req.body?.reassignTo || req.body?.reassign_to || null;

    if (!reason || reason.length < 5) {
      return res.status(400).json({ error: 'Termination reason is required and must be at least 5 characters.' });
    }

    const { rows } = await query(
      `SELECT terminate_employee($1::uuid, $2::uuid, $3::text, COALESCE($4::date, CURRENT_DATE), $5::uuid) AS result`,
      [req.params.id, req.user.id, reason, effectiveDate, reassignTo]
    );

    const result = rows[0]?.result || null;

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'hris.employee.terminate',
      entityType: 'employee',
      entityId: req.params.id,
      metadata: { reason, effectiveDate, reassignTo, result },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    res.json({ ok: true, result });
  } catch (err) {
    if (String(err?.message || '').includes('Cannot terminate employee')) {
      return res.status(409).json({ error: err.message, code: 'EMPLOYEE_HAS_ACTIVE_TASKS' });
    }
    next(err);
  }
});

router.get('/employees/:id/lifecycle', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const { rows } = await query(
      `SELECT e.*, u.full_name AS created_by_name, r.full_name AS reassigned_to_name
         FROM employee_lifecycle_events e
         LEFT JOIN users u ON u.id = e.created_by
         LEFT JOIN users r ON r.id = e.reassigned_to
        WHERE e.org_id = $1 AND e.employee_id = $2
        ORDER BY e.created_at DESC
        LIMIT 100`,
      [orgId, req.params.id]
    );

    res.json({ events: rows });
  } catch (err) { next(err); }
});

module.exports = router;
