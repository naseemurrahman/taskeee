'use strict';

const express = require('express');
const request = require('supertest');

function loadApp(context = {}) {
  jest.resetModules();

  const state = {
    columns: {
      tasks: ['id', 'org_id', 'title', 'status', 'assigned_to', 'metadata', 'updated_at', 'deleted_at', 'created_at', 'category_id'],
      ...(context.columns || {}),
    },
    subordinateIds: context.subordinateIds || [],
    subordinateThrows: context.subordinateThrows || false,
    assignableUser: context.assignableUser || { id: 'user-1', user_active: true, employee_active: true },
    rows: context.rows || [{ id: 'task-1', title: 'Held task', status: 'pending', assigned_to: 'user-1' }],
    count: context.count ?? 1,
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();

    if (text.includes('information_schema.columns')) {
      return { rows: (state.columns[params[0]] || []).map((column_name) => ({ column_name })) };
    }

    if (text.includes('SELECT user_id FROM get_subordinate_ids')) {
      if (state.subordinateThrows) throw new Error('function get_subordinate_ids does not exist');
      return { rows: state.subordinateIds.map((user_id) => ({ user_id })) };
    }

    if (text.includes('COALESCE(u.is_active, TRUE) AS user_active')) {
      return { rows: state.assignableUser ? [state.assignableUser] : [] };
    }

    if (text.includes('COUNT(DISTINCT t.id)::int AS count')) {
      return { rows: [{ count: state.count }] };
    }

    if (text.includes('SELECT t.*, u.full_name AS assigned_to_name')) {
      return { rows: state.rows };
    }

    if (text.includes('UPDATE tasks t')) {
      return { rows: state.rows, rowCount: state.rows.length };
    }

    return { rows: [] };
  });

  const withTransaction = jest.fn(async (callback) => callback({ query }));
  const emitNotification = jest.fn(async () => undefined);

  jest.doMock('../src/utils/db', () => ({ query, withTransaction }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = context.user || { id: 'admin-1', org_id: 'org-1', role: 'admin' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
    isOrgWideRole: (role) => ['admin', 'director', 'hr'].includes(role),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit: jest.fn(async () => undefined) }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity: jest.fn(async () => undefined) }));
  jest.doMock('../src/services/notificationService', () => ({ emitNotification }));

  const routes = require('../src/routes/reassignmentGovernance');
  const app = express();
  app.use(express.json());
  app.use('/tasks', routes);
  return { app, query, withTransaction, emitNotification };
}

describe('scoped reassignment governance', () => {
  test('manager reassignment list is scoped to self and subordinates', async () => {
    const { app, query } = loadApp({
      user: { id: 'manager-1', org_id: 'org-1', role: 'manager' },
      subordinateIds: ['user-1'],
      rows: [{ id: 'task-1', title: 'Scoped task', status: 'on_hold', assigned_to: 'user-1' }],
    });

    const res = await request(app).get('/tasks/reassignment-needed');

    expect(res.status).toBe(200);
    expect(res.body.scoped).toBe(true);
    expect(res.body.tasks[0].title).toBe('Scoped task');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('get_subordinate_ids'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('assigned_to = ANY'))).toBe(true);
  });

  test('manager can reassign an in-scope subordinate task', async () => {
    const { app, withTransaction, emitNotification } = loadApp({
      user: { id: 'manager-1', org_id: 'org-1', role: 'manager' },
      subordinateIds: ['user-1'],
      assignableUser: { id: 'user-1', user_active: true, employee_active: true },
      rows: [{ id: 'task-1', title: 'In-scope task', status: 'pending', assigned_to: 'user-1' }],
    });

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds: ['task-1'], assigned_to: 'user-1', status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledWith('user-1', expect.objectContaining({
      type: 'task.reassigned',
      data: expect.objectContaining({
        eventType: 'reassignment.completed',
        eventFamily: 'reassignment',
        eventAction: 'completed',
        legacyType: 'task.reassigned',
      }),
    }));
  });

  test('manager cannot reassign to an employee outside reporting scope', async () => {
    const { app, withTransaction } = loadApp({
      user: { id: 'manager-1', org_id: 'org-1', role: 'manager' },
      subordinateIds: ['user-1'],
      assignableUser: { id: 'outside-user', user_active: true, employee_active: true },
    });

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds: ['task-1'], assigned_to: 'outside-user', status: 'pending' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/outside your reporting scope/i);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  test('supervisor falls back to self-only reassignment scope when subordinate lookup is unavailable', async () => {
    const { app, query } = loadApp({
      user: { id: 'supervisor-1', org_id: 'org-1', role: 'supervisor' },
      subordinateThrows: true,
      rows: [{ id: 'task-1', title: 'Self scoped task', status: 'on_hold', assigned_to: 'supervisor-1' }],
    });

    const res = await request(app).get('/tasks/reassignment-needed');

    expect(res.status).toBe(200);
    expect(res.body.scoped).toBe(true);
    const listCall = query.mock.calls.find(([sql]) => String(sql).includes('SELECT t.*, u.full_name AS assigned_to_name'));
    expect(listCall).toBeTruthy();
    expect(listCall?.[1]).toEqual(['org-1', ['supervisor-1']]);
  });

  test('admin bulk reassignment notifies the new assignee with completed taxonomy', async () => {
    const { app, emitNotification } = loadApp({
      rows: [{ id: 'task-1', title: 'Notify task', status: 'pending', assigned_to: 'user-1' }],
    });

    const res = await request(app)
      .post('/tasks/reassign')
      .send({ taskIds: ['task-1'], assigned_to: 'user-1', status: 'pending' });

    expect(res.status).toBe(200);
    expect(emitNotification).toHaveBeenCalledWith('user-1', expect.objectContaining({
      type: 'task.reassigned',
      data: expect.objectContaining({
        eventType: 'reassignment.completed',
        eventFamily: 'reassignment',
        eventAction: 'completed',
        legacyType: 'task.reassigned',
        taskIds: ['task-1'],
      }),
    }));
  });
});
