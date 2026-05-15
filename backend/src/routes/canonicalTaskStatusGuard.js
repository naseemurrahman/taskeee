'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const router = express.Router();
const ACTIVE_WORKFLOW_STATUSES = new Set(['pending', 'in_progress', 'submitted', 'completed', 'manager_approved']);

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

async function guardStatusChange(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const { rows } = await query(
      'SELECT id, assigned_to, project_id FROM tasks WHERE id = $1 AND org_id = $2 LIMIT 1',
      [req.params.id, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];

    if (task.project_id) {
      const projectResult = await query(
        "SELECT id, name, COALESCE(status, 'active') AS status FROM projects WHERE id = $1 AND org_id = $2 LIMIT 1",
        [task.project_id, orgId]
      );
      const project = projectResult.rows[0];
      if (project && project.status !== 'active') {
        const allowedPausedMove = project.status === 'paused' && ['on_hold', 'cancelled'].includes(nextStatus);
        if (!allowedPausedMove) {
          return res.status(409).json({ error: `Task status cannot be changed while project \"${project.name || project.id}\" is ${project.status}. Reactivate the project first.`, code: 'PROJECT_NOT_ACTIVE', projectId: project.id, projectStatus: project.status });
        }
      }
    }

    if (ACTIVE_WORKFLOW_STATUSES.has(nextStatus) && task.assigned_to) {
      const userResult = await query(
        "SELECT id FROM users u WHERE u.id = $1 AND u.org_id = $2 AND COALESCE(u.is_active, TRUE) = TRUE AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.org_id = $2 AND COALESCE(e.status, 'active') <> 'active') LIMIT 1",
        [task.assigned_to, orgId]
      );
      if (!userResult.rows.length) return res.status(409).json({ error: 'This employee is inactive or terminated and cannot continue active task workflow.' });
    }

    return next();
  } catch (err) { next(err); }
}

router.post('/:id/set-status', authenticate, guardStatusChange);
router.patch('/:id/status', authenticate, guardStatusChange);
router.patch('/:id/board-status', authenticate, guardStatusChange);

module.exports = router;
