'use strict';

const express = require('express');
const request = require('supertest');

function loadApp(context = {}) {
  jest.resetModules();

  const state = {
    tables: context.tables || ['users', 'employees', 'tasks', 'task_categories', 'projects', 'project_tasks'],
    columns: {
      users: ['id', 'org_id', 'full_name', 'email', 'role', 'department', 'employee_code', 'is_active'],
      employees: ['id', 'org_id', 'user_id', 'full_name', 'status', 'updated_at'],
      tasks: ['id', 'org_id', 'title', 'status', 'assigned_to', 'category_id', 'project_id', 'priority', 'due_date', 'metadata', 'updated_at', 'deleted_at', 'created_at'],
      task_categories: ['id', 'org_id', 'name', 'description', 'status', 'is_active', 'color', 'icon', 'created_at'],
      projects: ['id', 'org_id', 'name', 'description', 'status', 'created_at'],
      ...(context.columns || {}),
    },
    assignableUser: context.assignableUser || { id: 'user-1', user_active: true, employee_active: true },
    task: context.task || { id: 'task-1', org_id: 'org-1', status: 'pending', assigned_to: 'user-1', category_id: 'project-1', project_id: null },
    project: context.project || { id: 'project-1', name: 'Project Alpha', status: 'active' },
    activeTaskCount: context.activeTaskCount ?? 0,
    employee: context.employee || { id: 'emp-1', org_id: 'org-1', user_id: 'user-1', full_name: 'Jane User', status: 'active' },
    reassignmentTasks: context.reassignmentTasks || [{ id: 'task-1', title: 'Held Task', status: 'on_hold', assigned_to: 'user-1', assigned_to_name: 'Jane User' }],
  };

  const query = jest.fn(async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();

    if (text.includes('information_schema.tables')) {
      return { rows: state.tables.map((table_name) => ({ table_name })) };
    }

    if (text.includes('information_schema.columns')) {
      const table = params[0];
      return { rows: (state.columns[table] || []).map((column_name) => ({ column_name })) };
    }

    if (text.startsWith('SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t')) {
      return { rows: [{ cnt: state.activeTaskCount }] };
    }

    if (text.startsWith('SELECT t.id, t.title, COALESCE(t.status')) {
      return { rows: state.reassignmentTasks };
    }

    if (text.includes('FROM users u') && text.includes('COALESCE(u.is_active, TRUE) AS user_active')) {
      return { rows: state.assignableUser ? [state.assignableUser] : [] };
    }

    if (text.includes('FROM users u') && text.includes('ORDER BY u.full_name ASC')) {
      return { rows: state.assignableUser?.user_active && state.assignableUser?.employee_active ? [{ id: 'user-1', full_name: 'Jane User', email: 'jane@example.com', role: 'employee', department: 'Ops', employee_code: 'E-1' }] : [] };
    }

    if (text.includes('FROM tasks') && text.includes('WHERE id = $1 AND org_id = $2')) {
      return { rows: [state.task] };
    }

    if (text.includes('FROM task_categories tc') && text.includes('WHERE tc.org_id = $1 AND tc.id = $2')) {
      return { rows: [state.project] };
    }

    if (text.includes('UPDATE task_categories')) {
      return { rows: [{ id: params[params.length - 1], name: state.project.name, status: params[0], is_active: params[0] === 'active', created_at: new Date().toISOString() }] };
    }

    if (text.includes('UPDATE projects')) {
      return { rows: [{ id: params[2], name: state.project.name, status: params[0], is_active: params[0] === 'active', created_at: new Date().toISOString() }] };
    }

    if (text.includes('UPDATE employees')) {
      return { rows: [{ ...state.employee, status: params[0] }] };
    }

    if (text.includes('UPDATE users SET is_active')) {
      return { rows: [], rowCount: 1 };
    }

    if (text.includes('UPDATE tasks')) {
      return { rows: [], rowCount: 1 };
    }

    if (text.includes('LEFT JOIN task_categories cat')) {
      return { rows: state.reassignmentTasks };
    }

    return { rows: [] };
  });

  jest.doMock('../src/utils/db', () => ({ query }));
  jest.doMock('../src/utils/orgContext', () => ({ orgIdForSessionUser: jest.fn(async () => 'org-1') }));
  jest.doMock('../src/middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = context.user || { id: 'admin-1', org_id: 'org-1', role: 'admin' }; next(); },
    requireAnyRole: (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }),
    isOrgWideRole: (role) => ['admin', 'director', 'hr'].includes(role),
  }));
  jest.doMock('../src/services/auditService', () => ({ logAudit: jest.fn(async () => undefined) }));
  jest.doMock('../src/services/activityService', () => ({ logUserActivity: jest.fn(async () => undefined) }));

  const routes = require('../src/routes/statusGovernance');
  const app = express();
  app.use(express.json());
  app.use('/projects', routes.projects);
  app.use('/tasks', routes.tasks);
  app.use('/hris', routes.hris);
  app.post('/tasks', (_req, res) => res.status(201).json({ ok: true }));
  app.patch('/tasks/:id', (_req, res) => res.json({ ok: true }));
  return { app, query };
}

describe('status governance overlays', () => {
  test('blocks task creation for inactive or terminated employees', async () => {
    const { app } = loadApp({ assignableUser: { id: 'user-1', user_active: false, employee_active: false } });

    const res = await request(app).post('/tasks').send({ title: 'Unsafe assignment', assignedTo: 'user-1' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/inactive|terminated/i);
  });

  test('blocks task status changes while parent project is paused', async () => {
    const { app } = loadApp({ project: { id: 'project-1', name: 'Paused Project', status: 'paused' } });

    const res = await request(app).post('/tasks/task-1/set-status').send({ status: 'in_progress' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_NOT_ACTIVE');
  });

  test('pausing a project moves active project tasks to on_hold', async () => {
    const { app, query } = loadApp({ activeTaskCount: 2, project: { id: 'project-1', name: 'Active Project', status: 'active' } });

    const res = await request(app).patch('/projects/project-1').send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(res.body.affectedActiveTasks).toBe(2);
    expect(query.mock.calls.some(([sql, params]) => String(sql).includes('UPDATE tasks t SET status = $3') && params.includes('on_hold'))).toBe(true);
  });

  test('completing a project with active tasks requires admin or director override', async () => {
    const { app } = loadApp({ activeTaskCount: 1, user: { id: 'manager-1', org_id: 'org-1', role: 'manager' } });

    const res = await request(app).patch('/projects/project-1').send({ status: 'completed', override_completion: true, override_reason: 'Operational closure' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin|Director/);
  });

  test('employee lifecycle change quarantines active tasks for reassignment', async () => {
    const { app, query } = loadApp();

    const res = await request(app).patch('/hris/employees/emp-1').send({ status: 'terminated' });

    expect(res.status).toBe(200);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status = 'on_hold'"))).toBe(true);
  });

  test('returns reassignment queue for management roles', async () => {
    const { app } = loadApp({ reassignmentTasks: [{ id: 'task-9', title: 'Reassign me', status: 'on_hold', assigned_to_name: 'Inactive User' }] });

    const res = await request(app).get('/tasks/reassignment-needed');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe('Reassign me');
  });
});
