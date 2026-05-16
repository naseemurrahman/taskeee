'use strict';

const express = require('express');
const request = require('supertest');

let mockState;

jest.mock('../../utils/db', () => ({
  query: jest.fn((sql, params) => mockQuery(sql, params)),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
  requireAnyRole: (...roles) => (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (roles.includes(role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  },
  isOrgWideRole: (role) => ['admin', 'director', 'hr'].includes(String(role || '').toLowerCase()),
}));

jest.mock('../../utils/orgContext', () => ({
  orgIdForSessionUser: jest.fn(() => Promise.resolve(mockState.orgId)),
}));

jest.mock('../../services/activityService', () => ({
  logUserActivity: jest.fn(() => Promise.resolve()),
}));

const { query } = require('../../utils/db');
const router = require('../taskCanonicalGuards');

function rows(data) {
  return Promise.resolve({ rows: data });
}

function columnRows(columns) {
  return columns.map((column_name) => ({ column_name }));
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tasks', router);
  app.use((req, res) => res.status(204).json({ reachedNextHandler: true, body: req.body }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

function resetState(overrides = {}) {
  mockState = {
    orgId: 'org-1',
    user: { id: 'manager-1', role: 'manager' },
    subordinateThrows: false,
    subordinateRows: [{ user_id: 'employee-1' }],
    assignableRows: [],
    task: {
      id: 'task-1',
      org_id: 'org-1',
      status: 'pending',
      assigned_to: 'employee-1',
      project_id: 'project-1',
    },
    project: { id: 'project-1', name: 'Active Project', status: 'active' },
    assigneeActive: true,
    timelineColumns: ['task_id', 'actor_type', 'event_type', 'actor_id', 'from_status', 'to_status', 'note'],
    ...overrides,
  };
  query.mockClear();
}

function mockQuery(sql, params = []) {
  const text = String(sql);

  if (text.includes('information_schema.columns')) {
    const table = params[0];
    if (table === 'tasks') {
      return rows(columnRows(['id', 'org_id', 'status', 'assigned_to', 'project_id', 'updated_at']));
    }
    if (table === 'task_timeline') {
      return rows(columnRows(mockState.timelineColumns || []));
    }
    return rows([]);
  }

  if (text.includes('get_subordinate_ids')) {
    if (mockState.subordinateThrows) return Promise.reject(new Error('function get_subordinate_ids does not exist'));
    return rows(mockState.subordinateRows || []);
  }

  if (text.includes('FROM users u') && text.includes('ORDER BY u.full_name')) {
    mockState.lastAssignableParams = params;
    return rows(mockState.assignableRows || []);
  }

  if (text.includes('FROM tasks WHERE id = $1') && text.includes('org_id = $2')) {
    return rows(mockState.task ? [mockState.task] : []);
  }

  if (text.includes('FROM projects') && text.includes('COALESCE(status')) {
    return rows(mockState.project ? [mockState.project] : []);
  }

  if (text.includes('FROM users u') && text.includes('u.id = $1') && text.includes('NOT EXISTS')) {
    return rows(mockState.assigneeActive ? [{ id: params[0] }] : []);
  }

  if (text.startsWith('UPDATE tasks SET')) {
    mockState.updatedStatus = params[0];
    return rows([{ id: mockState.task.id, status: params[0] }]);
  }

  if (text.startsWith('INSERT INTO task_timeline')) {
    mockState.timelineInserted = { sql: text, params };
    return rows([]);
  }

  return rows([]);
}

describe('taskCanonicalGuards', () => {
  beforeEach(() => resetState());

  test('assignable-users falls back to self-only scope when subordinate function is unavailable', async () => {
    resetState({
      subordinateThrows: true,
      assignableRows: [{ id: 'manager-1', full_name: 'Manager One', email: 'manager@example.com', role: 'manager', department: 'Ops', employee_code: 'M1' }],
    });

    const res = await request(makeApp()).get('/api/v1/tasks/assignable-users').expect(200);

    expect(res.body.users).toEqual([{ id: 'manager-1', name: 'Manager One', email: 'manager@example.com', role: 'manager', department: 'Ops', employeeCode: 'M1' }]);
    expect(mockState.lastAssignableParams).toEqual(['org-1', 'manager-1']);
  });

  test('task creation under active canonical project reaches downstream creator', async () => {
    resetState({ project: { id: 'project-1', name: 'Active Project', status: 'active' } });

    await request(makeApp())
      .post('/api/v1/tasks')
      .send({ title: 'Allowed', assignedTo: 'employee-1', projectId: 'project-1', categoryId: 'category-1' })
      .expect(204);

    const sqlText = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sqlText).toMatch(/FROM projects/i);
  });

  test('task creation under paused canonical project is blocked before downstream creator', async () => {
    resetState({ project: { id: 'project-1', name: 'Paused Project', status: 'paused' } });

    const res = await request(makeApp())
      .post('/api/v1/tasks')
      .send({ title: 'Blocked', assignedTo: 'employee-1', projectId: 'project-1', categoryId: 'category-1' })
      .expect(409);

    expect(res.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect(res.body.projectStatus).toBe('paused');
  });

  test('task creation uses projectId, not categoryId, for lifecycle checks', async () => {
    resetState({ project: null });

    await request(makeApp())
      .post('/api/v1/tasks')
      .send({ title: 'Category only', assignedTo: 'employee-1', categoryId: 'category-1' })
      .expect(204);

    const sqlText = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sqlText).not.toMatch(/task_categories/i);
  });

  test('task creation blocks inactive or terminated assignee', async () => {
    resetState({ assigneeActive: false });

    const res = await request(makeApp())
      .post('/api/v1/tasks')
      .send({ title: 'Blocked assignee', assignedTo: 'employee-1', projectId: 'project-1' })
      .expect(409);

    expect(res.body.error).toMatch(/inactive or terminated/i);
  });

  test('paused canonical project blocks active task workflow status changes', async () => {
    resetState({ project: { id: 'project-1', name: 'Paused Project', status: 'paused' } });

    const res = await request(makeApp()).patch('/api/v1/tasks/task-1/status').send({ status: 'in_progress' }).expect(409);

    expect(res.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect(mockState.updatedStatus).toBeUndefined();
  });

  test('task_categories status is not queried or used when task has no canonical project_id', async () => {
    resetState({ task: { id: 'task-1', org_id: 'org-1', status: 'pending', assigned_to: 'employee-1', project_id: null } });

    const res = await request(makeApp()).patch('/api/v1/tasks/task-1/status').send({ status: 'in_progress' }).expect(200);

    expect(res.body.status).toBe('in_progress');
    expect(mockState.updatedStatus).toBe('in_progress');
    const sqlText = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(sqlText).not.toMatch(/task_categories/i);
  });

  test('inactive or terminated assignee blocks active workflow statuses', async () => {
    resetState({ assigneeActive: false });

    const res = await request(makeApp()).patch('/api/v1/tasks/task-1/status').send({ status: 'in_progress' }).expect(409);

    expect(res.body.error).toMatch(/inactive or terminated/i);
    expect(mockState.updatedStatus).toBeUndefined();
  });

  test('successful status change writes a timeline entry without blocking status update', async () => {
    await request(makeApp()).post('/api/v1/tasks/task-1/set-status').send({ status: 'in_progress', note: 'starting' }).expect(200);

    expect(mockState.updatedStatus).toBe('in_progress');
    expect(mockState.timelineInserted).toBeTruthy();
    expect(mockState.timelineInserted.params).toEqual(['task-1', 'user', 'status_changed', 'manager-1', 'pending', 'in_progress', 'starting']);
  });
});
