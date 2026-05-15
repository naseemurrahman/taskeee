'use strict';

const express = require('express');
const request = require('supertest');

function loadApp(context = {}) {
  jest.resetModules();

  const state = {
    columns: {
      tasks: ['id', 'org_id', 'title', 'status', 'assigned_to', 'metadata', 'updated_at', 'deleted_at'],
      ...(context.columns || {}),
    },
    assignableUser: context.assignableUser || { id: 'active-user', user_active: true, employee_active: true },
    reassignmentCount: context.reassignmentCount ?? 3,
    updatedRows: context.updatedRows || [{ id: 'task-1', title: 'Held task', status: 'pending', assigned_to: 'active-user' }],
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();

    if (text.includes('information_schema.columns')) {
      const table = params[0];
      return { rows: (state.columns[table] || []).map((column_name) => ({ column_name })) };
    }

    if (text.includes('COALESCE(u.is_active, TRUE) AS user_active')) {
      return { rows: state.assignableUser ? [state.assignableUser] : [] };
    }

    if (text.includes('COUNT(DISTINCT t.id)::int AS count')) {
      return { rows: [{ count: state.reassignmentCount }] };
    }

    if (text.includes('UPDATE tasks t')) {
      return { rows: state.updatedRows, rowCount: state.updatedRows.length };
    }

    return { rows: [] };
  });

  const withTransaction = jest.fn(async (callback) => callback({ query }));

  jest.doMock('../src/utils/db', () => ({ query, withTransaction }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = context.user || { id: 'admin-1', org_id: 'org-1', role: 'admin' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit: jest.fn(async () => undefined) }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity: jest.fn(async () => undefined) }));

  const routes = require('../src/routes/reassignmentGovernance');
  const app = express();
  app.use(express.json());
  app.use('/tasks', routes);
  return { app, query, withTransaction };
}

describe('reassignment governance routes', () => {
  test('returns reassignment-needed count', async () => {
    const { app } = loadApp({ reassignmentCount: 7 });

    const res = await request(app).get('/tasks/reassignment-needed/count');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
  });

  test('bulk reassigns eligible tasks in one transaction', async () => {
    const { app, query, withTransaction } = loadApp({
      updatedRows: [
        { id: 'task-1', title: 'Held task', status: 'pending', assigned_to: 'active-user' },
      ],
    });

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds: ['task-1'], assigned_to: 'active-user', status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks t'))).toBe(true);
  });

  test('blocks bulk reassignment to inactive assignee', async () => {
    const { app, withTransaction } = loadApp({ assignableUser: { id: 'inactive-user', user_active: false, employee_active: false } });

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds: ['task-1'], assigned_to: 'inactive-user', status: 'pending' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/inactive|unavailable/i);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('rejects oversized bulk reassignment requests', async () => {
    const { app } = loadApp();
    const taskIds = Array.from({ length: 201 }, (_, i) => `task-${i}`);

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds, assigned_to: 'active-user', status: 'pending' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than 200/i);
  });
});
