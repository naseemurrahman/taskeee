'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockEmitNotification = jest.fn();
const mockLogUserActivity = jest.fn();

jest.mock('../utils/db', () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 'admin-user-1',
      org_id: 'org-1',
      orgId: 'org-1',
      role: 'admin',
      is_active: true,
    };
    next();
  },
  requireAnyRole: () => (_req, _res, next) => next(),
  isOrgWideRole: () => true,
}));

jest.mock('../utils/orgContext', () => ({
  orgIdForSessionUser: jest.fn(async (req) => req.user?.org_id || req.user?.orgId || null),
}));

jest.mock('../services/notificationService', () => ({
  emitNotification: (...args) => mockEmitNotification(...args),
}));

jest.mock('../services/activityService', () => ({
  logUserActivity: (...args) => mockLogUserActivity(...args),
}));

const canonicalTaskProjects = require('../routes/canonicalTaskProjects');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tasks', canonicalTaskProjects);
  app.use('/api/v1/tasks', (_req, res) => res.status(599).json({ error: 'legacy task route should not receive this request' }));
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function columnRows(names) {
  return { rows: names.map((column_name) => ({ column_name })) };
}

function installCommonMocks({ projectStatus = 'active', projectIsActive = true, categoryMatchesProject = false } = {}) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);

    if (text.includes('information_schema.columns')) {
      if (params[0] === 'tasks') return columnRows(['id', 'org_id', 'title', 'status', 'project_id', 'category_id', 'assigned_to', 'assigned_by', 'priority', 'due_date', 'metadata']);
      if (params[0] === 'projects') return columnRows(['id', 'org_id', 'name', 'status', 'is_active']);
    }

    if (text.includes('SELECT p.id, p.name') && text.includes('FROM projects p')) {
      expect(text).toContain("CASE WHEN p.is_active = FALSE THEN 'completed'");
      const id = text.includes('p.id::text = $2::text') ? 'category-project-1' : params[0];
      const status = projectIsActive === false ? 'completed' : projectStatus;
      if (text.includes('p.id::text = $2::text') && !categoryMatchesProject) return { rows: [] };
      return { rows: [{ id, name: 'Canonical Project', status }] };
    }

    if (text.includes('FROM users u') && text.includes('COALESCE(u.is_active, TRUE) = TRUE')) {
      return { rows: [{ id: 'user-1' }] };
    }

    if (text.includes('FROM task_categories') && text.includes('SELECT id')) {
      return { rows: [{ id: params[0] }] };
    }

    if (text.includes('INSERT INTO tasks')) {
      const projectIdIndex = text.match(/project_id/) ? text.split(/project_id/)[0].match(/,/g)?.length || 0 : -1;
      return {
        rows: [{
          id: 'task-1',
          title: 'Canonical task',
          status: 'pending',
          assigned_to: 'user-1',
          project_id: projectIdIndex >= 0 ? 'project-1' : null,
        }],
      };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
}

describe('canonical task project creation guards', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmitNotification.mockReset();
    mockLogUserActivity.mockReset();
    mockEmitNotification.mockResolvedValue(undefined);
    mockLogUserActivity.mockResolvedValue(undefined);
  });

  test('rejects task creation for inactive canonical project even when stale status says active', async () => {
    const app = makeApp();
    installCommonMocks({ projectStatus: 'active', projectIsActive: false });

    const res = await request(app)
      .post('/api/v1/tasks')
      .send({ title: 'Inactive project task', assignedTo: 'user-1', projectId: 'project-1' })
      .expect(409);

    expect(res.body).toMatchObject({ code: 'PROJECT_NOT_ACTIVE', projectId: 'project-1', projectStatus: 'completed' });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tasks'))).toBe(false);
  });

  test('creates canonical project task with project_id for active project', async () => {
    const app = makeApp();
    installCommonMocks({ projectStatus: 'active', projectIsActive: true });

    const res = await request(app)
      .post('/api/v1/tasks')
      .send({ title: 'Active project task', assignedTo: 'user-1', projectId: 'project-1' })
      .expect(201);

    expect(res.body.task).toMatchObject({ id: 'task-1', status: 'pending' });
    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall[0])).toContain('project_id');
  });

  test('create-simple resolves legacy category to canonical project and intercepts before legacy route', async () => {
    const app = makeApp();
    installCommonMocks({ projectStatus: 'active', projectIsActive: true, categoryMatchesProject: true });

    const res = await request(app)
      .post('/api/v1/tasks/create-simple')
      .send({ title: 'Category mapped task', assignedTo: 'user-1', categoryId: 'legacy-category-1' })
      .expect(201);

    expect(res.body.task).toMatchObject({ id: 'task-1', status: 'pending' });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tasks') && String(sql).includes('project_id'))).toBe(true);
  });
});
