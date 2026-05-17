'use strict';

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockLogAuditEvent = jest.fn();

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
}));

jest.mock('../services/auditService', () => ({
  ensureAuditSchema: jest.fn(async () => undefined),
  logAuditEvent: (...args) => mockLogAuditEvent(...args),
}));

jest.mock('../services/notificationService', () => ({
  emitNotification: jest.fn(async () => undefined),
  retryNotificationDelivery: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../services/notificationChannels', () => ({
  sendEmail: jest.fn(async () => ({ ok: true })),
  sendWhatsApp: jest.fn(async () => ({ ok: true })),
}));

const adminRoutes = require('../routes/admin');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', adminRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function tableRows(exists = true) {
  return { rows: exists ? [{ exists: 1 }] : [] };
}

function columnRows(names) {
  return { rows: names.map((column_name) => ({ column_name })) };
}

function countRows(count) {
  return { rows: [{ count }] };
}

const TASK_COLUMNS = ['id', 'org_id', 'title', 'category_id', 'project_id', 'status', 'deleted_at', 'updated_at'];
const PROJECT_COLUMNS = ['id', 'org_id', 'name', 'status', 'created_at', 'updated_at'];
const CATEGORY_COLUMNS = ['id', 'org_id', 'name', 'status', 'is_active', 'created_at', 'updated_at'];

function mockMigrationHealthQueries({ missingProjectId = 0, legacyWithoutProject = 0 } = {}) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    const table = params[0];

    if (text.includes('information_schema.tables')) {
      return tableRows(['tasks', 'projects', 'task_categories'].includes(table));
    }

    if (text.includes('information_schema.columns')) {
      if (table === 'tasks') return columnRows(TASK_COLUMNS);
      if (table === 'projects') return columnRows(PROJECT_COLUMNS);
      if (table === 'task_categories') return columnRows(CATEGORY_COLUMNS);
    }

    if (text.includes('LEFT JOIN projects p ON p.id = t.project_id') && text.includes('p.id IS NULL')) {
      return countRows(0);
    }

    if (text.includes('category_id IS NOT NULL') && text.includes('project_id IS NULL') && text.includes('COUNT(*)::int AS count')) {
      return countRows(missingProjectId);
    }

    if (text.includes('SELECT id, title, category_id') && text.includes('project_id IS NULL')) {
      return {
        rows: missingProjectId > 0
          ? [{ id: 'task-1', title: '3 Racks Port Mapping', category_id: 'legacy-category-1' }]
          : [],
      };
    }

    if (text.includes('FROM projects') && text.includes("NOT IN ('active','paused','completed','archived')")) {
      return countRows(0);
    }

    if (text.includes('FROM task_categories') && text.includes('is_active = FALSE') && text.includes("COALESCE(NULLIF(status, ''), 'active') = 'active'") && text.includes('COUNT(*)::int AS count')) {
      return countRows(0);
    }

    if (text.includes('FROM task_categories tc') && text.includes('NOT EXISTS') && text.includes('LOWER(TRIM(p.name))') && text.includes('COUNT(*)::int AS count')) {
      return countRows(legacyWithoutProject);
    }

    if (text.includes('HAVING COUNT(DISTINCT p.id) > 1')) {
      return countRows(0);
    }

    if (text.includes('HAVING COUNT(DISTINCT t.project_id) > 1')) {
      return countRows(0);
    }

    throw new Error(`Unexpected query: ${text}`);
  });
}

describe('project migration health diagnostics', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLogAuditEvent.mockReset();
  });

  test('returns ok=true when canonical project migration state is clean', async () => {
    mockMigrationHealthQueries();
    const app = makeApp();

    const res = await request(app)
      .get('/api/v1/admin/project-migration-health')
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.samples).toEqual({});
    expect(res.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'projects_table_present', ok: true, count: 1 }),
      expect.objectContaining({ key: 'tasks_project_id_column_present', ok: true, count: 1 }),
      expect.objectContaining({ key: 'categorized_tasks_missing_project_id', ok: true, count: 0 }),
      expect.objectContaining({ key: 'legacy_categories_without_canonical_match', ok: true, count: 0 }),
    ]));
    expect(mockLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'project_migration_health_checked' }));
  });

  test('returns ok=false and samples when categorized tasks are missing project_id', async () => {
    mockMigrationHealthQueries({ missingProjectId: 1, legacyWithoutProject: 1 });
    const app = makeApp();

    const res = await request(app)
      .get('/api/v1/admin/project-migration-health')
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(res.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'categorized_tasks_missing_project_id', ok: false, count: 1, severity: 'high' }),
      expect.objectContaining({ key: 'legacy_categories_without_canonical_match', ok: false, count: 1, severity: 'medium' }),
    ]));
    expect(res.body.samples.categorized_tasks_missing_project_id).toEqual([
      { id: 'task-1', title: '3 Racks Port Mapping', category_id: 'legacy-category-1' },
    ]);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'project_migration_health_checked' }));
  });
});
