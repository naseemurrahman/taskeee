'use strict';

const express = require('express');
const request = require('supertest');

function loadApp({ projectStatus = 'paused' } = {}) {
  jest.resetModules();

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();

    if (text.includes('information_schema.columns')) {
      const table = params[0];
      if (table === 'projects') return { rows: ['id', 'org_id', 'name', 'status'].map((column_name) => ({ column_name })) };
      if (table === 'tasks') return { rows: ['id', 'org_id', 'status', 'assigned_to', 'project_id'].map((column_name) => ({ column_name })) };
      return { rows: [] };
    }

    if (text.startsWith('SELECT id, org_id, status, assigned_to, project_id FROM tasks')) {
      return { rows: [{ id: 'task-1', org_id: 'org-1', status: 'pending', assigned_to: 'old-user', project_id: 'project-1' }] };
    }

    if (text.startsWith('SELECT p.id, p.name')) {
      return { rows: [{ id: 'project-1', name: 'Paused Project', status: projectStatus }] };
    }

    if (text.includes('COALESCE(u.is_active, TRUE) AS user_active')) {
      return { rows: [{ id: 'new-user', user_active: true, employee_active: true }] };
    }

    return { rows: [] };
  });

  jest.doMock('../src/utils/db', () => ({ query }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: 'admin-1', org_id: 'org-1', role: 'admin' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
    isOrgWideRole: (role) => ['admin', 'director', 'hr'].includes(role),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit: jest.fn(async () => undefined) }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity: jest.fn(async () => undefined) }));

  const { tasks } = require('../src/routes/statusGovernance');
  const app = express();
  app.use(express.json());
  app.use('/tasks', tasks);
  return { app, query };
}

describe('task reassignment project lifecycle guard', () => {
  test('blocks assignee changes when the existing task project is paused', async () => {
    const { app, query } = loadApp({ projectStatus: 'paused' });

    const res = await request(app)
      .patch('/tasks/task-1/details')
      .send({ assignedTo: 'new-user' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      code: 'PROJECT_NOT_ACTIVE',
      projectId: 'project-1',
      projectStatus: 'paused',
    }));
    expect(res.body.error).toMatch(/Cannot reassign task while project/i);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('COALESCE(u.is_active, TRUE) AS user_active'))).toBe(false);
  });

  test('checks assignee availability when the existing task project is active', async () => {
    const { app, query } = loadApp({ projectStatus: 'active' });

    const res = await request(app)
      .patch('/tasks/task-1/details')
      .send({ assignedTo: 'new-user' });

    expect(res.status).toBe(404);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('COALESCE(u.is_active, TRUE) AS user_active'))).toBe(true);
  });
});
