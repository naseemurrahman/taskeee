'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockTxQuery = jest.fn();
const mockWithTransaction = jest.fn();
const mockLogAudit = jest.fn();
const mockLogAuditEvent = jest.fn();
const mockLogUserActivity = jest.fn();

jest.mock('../utils/db', () => ({
  query: (...args) => mockQuery(...args),
  withTransaction: (...args) => mockWithTransaction(...args),
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
}));

jest.mock('../utils/orgContext', () => ({
  orgIdForSessionUser: jest.fn(async (req) => req.user?.org_id || req.user?.orgId || null),
}));

jest.mock('../services/auditService', () => ({
  logAudit: (...args) => mockLogAudit(...args),
  logAuditEvent: (...args) => mockLogAuditEvent(...args),
}));

jest.mock('../services/activityService', () => ({
  logUserActivity: (...args) => mockLogUserActivity(...args),
}));

const projectReadStatusFix = require('../routes/projectReadStatusFix');
const adminProjectMigrationRepair = require('../routes/adminProjectMigrationRepair');

function makeApp(basePath, router) {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function columnRows(names) {
  return { rows: names.map((column_name) => ({ column_name })) };
}

function tableRows(exists = true) {
  return { rows: exists ? [{ '?column?': 1 }] : [] };
}

describe('project lifecycle regression coverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTxQuery.mockReset();
    mockLogAudit.mockReset();
    mockLogAuditEvent.mockReset();
    mockLogUserActivity.mockReset();
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async (callback) => callback({ query: mockTxQuery }));
  });

  test('blocks project completion when unresolved canonical tasks remain', async () => {
    const app = makeApp('/api/v1/projects', projectReadStatusFix);

    mockQuery.mockImplementation(async (sql, params = []) => {
      if (String(sql).includes('information_schema.columns') && params[0] === 'tasks') {
        return columnRows(['id', 'org_id', 'project_id', 'status', 'deleted_at']);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    mockTxQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT p.id, p.name') && text.includes('FROM projects p')) {
        return { rows: [{ id: 'project-1', name: 'MOI' }] };
      }
      if (text.includes('SELECT COUNT(DISTINCT t.id)::int AS cnt')) {
        return { rows: [{ cnt: 2 }] };
      }
      if (text.includes('UPDATE projects')) {
        throw new Error('projects update should not run while unresolved tasks exist');
      }
      throw new Error(`Unexpected tx query: ${sql}`);
    });

    const res = await request(app)
      .patch('/api/v1/projects/project-1')
      .send({ status: 'completed', project_name: 'MOI' })
      .expect(409);

    expect(res.body).toMatchObject({
      code: 'PROJECT_HAS_UNRESOLVED_TASKS',
      activeTaskCount: 2,
    });
    expect(mockTxQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE projects'))).toBe(false);
  });

  test('completes canonical project and mirrors legacy inactive flag outside canonical transaction', async () => {
    const app = makeApp('/api/v1/projects', projectReadStatusFix);

    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('information_schema.columns')) {
        if (params[0] === 'tasks') return columnRows(['id', 'org_id', 'project_id', 'category_id', 'status', 'deleted_at']);
        if (params[0] === 'projects') return columnRows(['id', 'org_id', 'name', 'status', 'updated_by', 'updated_at', 'created_at']);
        if (params[0] === 'task_categories') return columnRows(['id', 'org_id', 'name', 'is_active', 'updated_at']);
      }
      if (text.includes('information_schema.tables') && params[0] === 'task_categories') return tableRows(true);
      if (text.includes('UPDATE task_categories')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });

    mockTxQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT p.id, p.name') && text.includes('FROM projects p')) {
        return { rows: [{ id: 'project-1', name: 'MOI' }] };
      }
      if (text.includes('SELECT COUNT(DISTINCT t.id)::int AS cnt')) return { rows: [{ cnt: 0 }] };
      if (text.includes('UPDATE projects')) {
        return {
          rows: [{
            id: 'project-1',
            name: 'MOI',
            description: null,
            icon: null,
            color: null,
            status: 'completed',
            is_active: false,
            created_at: '2026-05-17T00:00:00.000Z',
            source_store: 'projects',
          }],
        };
      }
      throw new Error(`Unexpected tx query: ${sql}`);
    });

    const res = await request(app)
      .patch('/api/v1/projects/project-1')
      .send({ status: 'completed', project_name: 'MOI' })
      .expect(200);

    expect(res.body.project).toMatchObject({ id: 'project-1', status: 'completed', is_active: false });
    expect(res.body.legacyMirror).toMatchObject({ rows: 1, skipped: false });
    expect(mockTxQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE projects'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE task_categories') && String(sql).includes('is_active = FALSE'))).toBe(true);
    expect(mockLogUserActivity).toHaveBeenCalledWith(expect.objectContaining({ activityType: 'project_status_changed' }));
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.status.changed' }));
  });

  test('reads inactive legacy project rows as completed even when legacy status is stale active', async () => {
    const app = makeApp('/api/v1/projects', projectReadStatusFix);

    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('information_schema.tables')) {
        if (params[0] === 'projects') return tableRows(true);
        if (params[0] === 'task_categories') return tableRows(true);
      }
      if (text.includes('information_schema.columns')) {
        if (params[0] === 'projects') return columnRows(['id', 'org_id', 'name', 'status']);
        if (params[0] === 'tasks') return columnRows(['id', 'org_id', 'project_id', 'category_id', 'deleted_at']);
        if (params[0] === 'task_categories') return columnRows(['id', 'org_id', 'name', 'status', 'is_active', 'created_at']);
      }
      if (text.includes('FROM projects p') && text.includes('GROUP BY p.id')) return { rows: [] };
      if (text.includes('FROM task_categories tc') && text.includes('GROUP BY tc.id')) {
        expect(text).toContain("CASE WHEN tc.is_active = FALSE THEN 'completed'");
        return {
          rows: [{
            id: 'legacy-1',
            name: 'Legacy Project',
            description: null,
            icon: null,
            color: null,
            status: 'completed',
            is_active: false,
            created_at: '2026-05-17T00:00:00.000Z',
            task_count: 0,
            source_store: 'task_categories',
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const res = await request(app)
      .get('/api/v1/projects')
      .expect(200);

    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0]).toMatchObject({ id: 'legacy-1', status: 'completed', is_active: false });
    expect(res.body.meta.store).toBe('authoritative_project_status_read');
  });
});

describe('project migration repair regression coverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTxQuery.mockReset();
    mockLogAuditEvent.mockReset();
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async (callback) => callback({ query: mockTxQuery }));
  });

  test('creates canonical project for legacy category and backfills missing task project_id', async () => {
    const app = makeApp('/api/v1/admin', adminProjectMigrationRepair);

    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('information_schema.tables')) return tableRows(true);
      if (text.includes('information_schema.columns')) {
        if (params[0] === 'projects') return columnRows(['id', 'org_id', 'name', 'description', 'status', 'created_by', 'updated_by', 'metadata', 'created_at', 'updated_at']);
        if (params[0] === 'task_categories') return columnRows(['id', 'org_id', 'name', 'description', 'status', 'is_active', 'created_at']);
        if (params[0] === 'tasks') return columnRows(['id', 'org_id', 'title', 'category_id', 'project_id', 'deleted_at', 'updated_at']);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    mockTxQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM task_categories tc') && text.includes('NOT EXISTS')) {
        return {
          rows: [{
            id: '7bb40aff-8d78-4134-a2a9-1927b5310105',
            name: 'MNGHA',
            description: null,
            status: 'active',
            is_active: true,
            created_at: '2026-05-17T00:00:00.000Z',
          }],
        };
      }
      if (text.includes('INSERT INTO projects')) return { rowCount: 1, rows: [] };
      if (text.includes('WITH category_project AS')) {
        return {
          rows: [{
            id: 'e896c415-1780-4bbe-bba9-fa2cd0c88809',
            title: '3 Racks Port Mapping',
            category_id: '7bb40aff-8d78-4134-a2a9-1927b5310105',
            project_id: '7bb40aff-8d78-4134-a2a9-1927b5310105',
          }],
        };
      }
      throw new Error(`Unexpected tx query: ${sql}`);
    });

    const res = await request(app)
      .post('/api/v1/admin/project-migration-repair')
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, orgId: 'org-1' });
    expect(res.body.repair.createdProjects).toEqual([
      {
        legacyCategoryId: '7bb40aff-8d78-4134-a2a9-1927b5310105',
        projectId: '7bb40aff-8d78-4134-a2a9-1927b5310105',
        name: 'MNGHA',
      },
    ]);
    expect(res.body.repair.backfilledTasks.rows).toBe(1);
    expect(res.body.repair.backfilledTasks.tasks[0]).toMatchObject({
      id: 'e896c415-1780-4bbe-bba9-fa2cd0c88809',
      project_id: '7bb40aff-8d78-4134-a2a9-1927b5310105',
    });
    expect(mockTxQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO projects'))).toBe(true);
    expect(mockTxQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks'))).toBe(true);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'project_migration_repair_run' }));
  });
});
