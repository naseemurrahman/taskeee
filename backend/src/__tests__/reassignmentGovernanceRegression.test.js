'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockWithTransaction = jest.fn();
const mockLogUserActivity = jest.fn();

jest.mock('../utils/db', () => ({
  query: (...args) => mockQuery(...args),
  withTransaction: (...args) => mockWithTransaction(...args),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'admin-user-1', org_id: 'org-1', orgId: 'org-1', role: 'admin' };
    next();
  },
  requireAnyRole: () => (_req, _res, next) => next(),
  isOrgWideRole: () => true,
}));

jest.mock('../utils/orgContext', () => ({
  orgIdForSessionUser: jest.fn(async (req) => req.user?.org_id || req.user?.orgId || null),
}));

jest.mock('../services/auditService', () => ({
  logAudit: jest.fn(async () => undefined),
}));

jest.mock('../services/activityService', () => ({
  logUserActivity: (...args) => mockLogUserActivity(...args),
}));

jest.mock('../services/notificationService', () => ({
  emitNotification: jest.fn(async () => undefined),
}));

const reassignmentGovernance = require('../routes/reassignmentGovernance');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tasks', reassignmentGovernance);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function columnRows(names) {
  return { rows: names.map((column_name) => ({ column_name })) };
}

describe('reassignment governance project status precedence', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
    mockLogUserActivity.mockReset();
  });

  test('blocks task workflow when canonical project is inactive even if stale status is active', async () => {
    const app = makeApp();

    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);

      if (text.includes('information_schema.columns')) {
        if (params[0] === 'tasks') return columnRows(['id', 'org_id', 'title', 'status', 'assigned_to', 'project_id', 'updated_at']);
        if (params[0] === 'projects') return columnRows(['id', 'org_id', 'name', 'status', 'is_active']);
        if (params[0] === 'task_timeline') return columnRows([]);
      }

      if (text.includes('SELECT id, org_id') && text.includes('FROM tasks')) {
        return {
          rows: [{
            id: 'task-1',
            org_id: 'org-1',
            title: 'Blocked task',
            status: 'pending',
            assigned_to: 'user-1',
            project_id: 'project-1',
          }],
        };
      }

      if (text.includes('SELECT p.id, p.name') && text.includes('FROM projects p')) {
        expect(text).toContain("CASE WHEN p.is_active = FALSE THEN 'completed'");
        return { rows: [{ id: 'project-1', name: 'Inactive Canonical Project', status: 'completed' }] };
      }

      if (text.includes('UPDATE tasks')) {
        throw new Error('task status update should be blocked for inactive project');
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    const res = await request(app)
      .post('/api/v1/tasks/task-1/set-status')
      .send({ status: 'in_progress' })
      .expect(409);

    expect(res.body).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      projectId: 'project-1',
      projectStatus: 'completed',
    });
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(false);
    expect(mockLogUserActivity).not.toHaveBeenCalled();
  });
});
