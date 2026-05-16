'use strict';

const express = require('express');
const request = require('supertest');

function makeCanonicalProjectApp(overrides = {}) {
  jest.resetModules();

  const state = {
    activeTaskCount: overrides.activeTaskCount ?? 2,
    project: overrides.project === undefined ? { id: 'project-1', name: 'Locked Project' } : overrides.project,
    legacyCategory: overrides.legacyCategory === undefined ? null : overrides.legacyCategory,
    insertedProject: null,
    backfilledTasks: false,
    columns: {
      tasks: ['id', 'org_id', 'status', 'project_id', 'metadata', 'updated_at', 'deleted_at', 'assigned_to', 'category_id'],
      projects: ['id', 'org_id', 'name', 'description', 'status', 'metadata', 'created_at', 'updated_at', 'updated_by', 'created_by'],
      task_categories: ['id', 'org_id', 'name', 'description', 'status', 'is_active', 'created_at'],
      ...(overrides.columns || {}),
    },
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.includes('information_schema.columns')) {
      return { rows: (state.columns[params[0]] || []).map((column_name) => ({ column_name })) };
    }
    if (text.includes('SELECT DISTINCT assigned_to')) return { rows: [] };
    return { rows: [] };
  });

  const txQuery = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.includes('FROM projects') && text.includes('FOR UPDATE')) {
      if (state.project) return { rows: [state.project] };
      if (state.insertedProject) return { rows: [{ id: state.insertedProject.id, name: state.insertedProject.name }] };
      return { rows: [] };
    }
    if (text.includes('FROM task_categories tc')) {
      return { rows: state.legacyCategory ? [state.legacyCategory] : [] };
    }
    if (text.startsWith('INSERT INTO projects')) {
      state.insertedProject = { id: params[0], org_id: params[1], name: params[2], status: params.includes('paused') ? 'paused' : 'active' };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE tasks') && text.includes('SET project_id = $2')) {
      state.backfilledTasks = true;
      return { rows: [], rowCount: 2 };
    }
    if (text.includes('COUNT(DISTINCT t.id)::int AS cnt')) {
      return { rows: [{ cnt: state.activeTaskCount }] };
    }
    if (text.startsWith('UPDATE projects SET')) {
      return { rows: [{ id: params[params.length - 1], name: (state.project || state.insertedProject || {}).name, status: params[0], is_active: params[0] === 'active', source_store: 'projects' }], rowCount: 1 };
    }
    if (text.startsWith('UPDATE tasks t SET')) {
      return { rows: [], rowCount: state.activeTaskCount };
    }
    return { rows: [] };
  });

  const withTransaction = jest.fn(async (callback) => callback({ query: txQuery }));
  const logAudit = jest.fn(async () => undefined);
  const logUserActivity = jest.fn(async () => undefined);
  const emitNotification = jest.fn(async () => undefined);
  const notifyOrgLeaders = jest.fn(async () => undefined);

  jest.doMock('../src/utils/db', () => ({ query, withTransaction }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = overrides.user || { id: 'admin-1', org_id: 'org-1', role: 'admin' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity }));
  jest.doMock('../src/services/notificationService', () => ({ emitNotification, notifyOrgLeaders }));

  const router = require('../src/routes/canonicalProjectLifecycle');
  const app = express();
  app.use(express.json());
  app.use('/projects', router);
  return { app, query, txQuery, withTransaction, logAudit, logUserActivity, state };
}

function makeEmployeeLifecycleApp(overrides = {}) {
  jest.resetModules();

  const originalSetImmediate = global.setImmediate;
  global.setImmediate = (fn, ...args) => { fn(...args); return 0; };

  const state = {
    affectedTaskCount: overrides.affectedTaskCount ?? 3,
    employee: overrides.employee || { id: 'emp-1', user_id: 'user-1', full_name: 'Employee One', status: 'active' },
    leaders: overrides.leaders || [{ id: 'admin-2' }, { id: 'hr-1' }],
    columns: {
      tasks: ['id', 'org_id', 'status', 'assigned_to', 'metadata', 'updated_at', 'deleted_at'],
      employees: ['id', 'org_id', 'user_id', 'status'],
      users: ['id', 'org_id', 'is_active', 'role'],
      ...(overrides.columns || {}),
    },
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.includes('information_schema.columns')) {
      return { rows: (state.columns[params[0]] || []).map((column_name) => ({ column_name })) };
    }
    if (text.includes('information_schema.tables')) {
      return { rows: [{ table_name: 'projects' }, { table_name: 'tasks' }, { table_name: 'employees' }, { table_name: 'users' }] };
    }
    if (text.includes('SELECT id FROM users') && text.includes("role IN ('admin','director','hr')")) {
      return { rows: state.leaders };
    }
    return { rows: [] };
  });

  const txQuery = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('UPDATE employees SET status')) {
      return { rows: [{ ...state.employee, status: params[0] }], rowCount: 1 };
    }
    if (text.startsWith('UPDATE users SET is_active')) {
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE tasks SET')) {
      return { rows: [], rowCount: state.affectedTaskCount };
    }
    if (text.includes('FROM employees') && text.includes('FOR UPDATE')) {
      return { rows: [{ ...state.employee, role: overrides.employeeRole || 'employee' }] };
    }
    if (text.startsWith('DELETE FROM employees')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  });

  const withTransaction = jest.fn(async (callback) => callback({ query: txQuery }));
  const logAudit = jest.fn(async () => undefined);
  const logUserActivity = jest.fn(async () => undefined);
  const emitNotification = jest.fn(async () => undefined);

  jest.doMock('../src/utils/db', () => ({ query, withTransaction }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = overrides.user || { id: 'hr-actor', org_id: 'org-1', role: 'hr' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity }));
  jest.doMock('../src/services/notificationService', () => ({ emitNotification }));

  const { hris } = require('../src/routes/lifecycleTransactions');
  const app = express();
  app.use(express.json());
  app.use('/hris', hris);
  return { app, query, txQuery, withTransaction, emitNotification, restoreSetImmediate: () => { global.setImmediate = originalSetImmediate; } };
}

describe('canonical project lifecycle transaction regressions', () => {
  test('completion with active tasks locks project and counts active tasks inside transaction before rejecting', async () => {
    const { app, txQuery, withTransaction } = makeCanonicalProjectApp({ activeTaskCount: 2 });

    const res = await request(app).patch('/projects/project-1').send({ status: 'completed' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_HAS_ACTIVE_TASKS');
    expect(res.body.activeTaskCount).toBe(2);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    const txSql = txQuery.mock.calls.map(([sql]) => String(sql));
    expect(txSql[0]).toMatch(/FOR UPDATE/i);
    expect(txSql[1]).toMatch(/COUNT\(DISTINCT t\.id\)::int AS cnt/i);
    expect(txSql.some((sql) => /^UPDATE projects SET/i.test(sql))).toBe(false);
  });

  test('paused project lifecycle updates project and tasks in the same transaction', async () => {
    const { app, txQuery, withTransaction } = makeCanonicalProjectApp({ activeTaskCount: 4 });

    const res = await request(app).patch('/projects/project-1').send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('paused');
    expect(res.body.affectedActiveTasks).toBe(4);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    const txSql = txQuery.mock.calls.map(([sql]) => String(sql));
    expect(txSql.some((sql) => /FOR UPDATE/i.test(sql))).toBe(true);
    expect(txSql.some((sql) => /^UPDATE projects SET/i.test(sql))).toBe(true);
    expect(txSql.some((sql) => /^UPDATE tasks t SET/i.test(sql))).toBe(true);
  });

  test('legacy category project id is backfilled and then paused instead of failing canonical lookup', async () => {
    const { app, txQuery, state } = makeCanonicalProjectApp({
      project: null,
      legacyCategory: { id: 'legacy-project-1', org_id: 'org-1', name: 'NAJM', description: null, status: 'active', is_active: true, created_at: new Date('2026-01-01T00:00:00Z') },
      activeTaskCount: 2,
    });

    const res = await request(app).patch('/projects/legacy-project-1').send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('paused');
    expect(res.body.resolvedFrom).toBe('task_categories_backfill');
    expect(res.body.canonicalProjectId).toBe('legacy-project-1');
    expect(state.backfilledTasks).toBe(true);
    const txSql = txQuery.mock.calls.map(([sql]) => String(sql));
    expect(txSql.some((sql) => /^INSERT INTO projects/i.test(sql))).toBe(true);
    expect(txSql.some((sql) => /^UPDATE tasks\s+SET project_id = \$2/i.test(sql))).toBe(true);
    expect(txSql.some((sql) => /^UPDATE tasks t SET/i.test(sql))).toBe(true);
  });
});

describe('employee lifecycle reassignment-created regressions', () => {
  afterEach(() => {
    if (global.__restoreSetImmediateForLifecycleTests) {
      global.__restoreSetImmediateForLifecycleTests();
      delete global.__restoreSetImmediateForLifecycleTests;
    }
  });

  test('inactive employee lifecycle returns affectedTaskCount and emits reassignment.created notifications', async () => {
    const helpers = makeEmployeeLifecycleApp({ affectedTaskCount: 3 });
    global.__restoreSetImmediateForLifecycleTests = helpers.restoreSetImmediate;

    const res = await request(helpers.app).patch('/hris/employees/emp-1').send({ status: 'inactive' });

    expect(res.status).toBe(200);
    expect(res.body.affectedTaskCount).toBe(3);
    expect(helpers.withTransaction).toHaveBeenCalledTimes(1);
    const taskUpdateCall = helpers.txQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE tasks SET'));
    expect(taskUpdateCall).toBeTruthy();
    expect(JSON.stringify(taskUpdateCall[1])).toContain('reassignment.created');
    expect(helpers.emitNotification).toHaveBeenCalledWith('admin-2', expect.objectContaining({
      type: 'reassignment.created',
      data: expect.objectContaining({ eventType: 'reassignment.created', eventAction: 'created', affectedTaskCount: 3 }),
    }));
  });

  test('employee delete locks employee row and emits reassignment.created when tasks are quarantined', async () => {
    const helpers = makeEmployeeLifecycleApp({ affectedTaskCount: 2 });
    global.__restoreSetImmediateForLifecycleTests = helpers.restoreSetImmediate;

    const res = await request(helpers.app).delete('/hris/employees/emp-1');

    expect(res.status).toBe(200);
    expect(res.body.affectedTaskCount).toBe(2);
    expect(helpers.txQuery.mock.calls.some(([sql]) => /FOR UPDATE/i.test(String(sql)))).toBe(true);
    expect(helpers.emitNotification).toHaveBeenCalledWith('admin-2', expect.objectContaining({
      type: 'reassignment.created',
      data: expect.objectContaining({ reason: 'employee_deleted', affectedTaskCount: 2 }),
    }));
  });
});
