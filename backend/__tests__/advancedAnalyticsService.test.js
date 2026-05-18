jest.mock('../src/utils/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/employeeVisibility', () => ({
  filterNonTerminatedUserIds: jest.fn(),
}));

const { query } = require('../src/utils/db');
const { filterNonTerminatedUserIds } = require('../src/utils/employeeVisibility');

const taskColumns = [
  'id', 'title', 'org_id', 'assigned_to', 'project_id', 'status', 'priority',
  'created_at', 'updated_at', 'completed_at', 'due_date',
].map(column_name => ({ column_name }));

const userColumns = [
  'id', 'org_id', 'full_name', 'department',
].map(column_name => ({ column_name }));

function loadService() {
  // Keep the already-configured db/visibility mocks intact while reloading the
  // service so its module-level table/column caches are fresh for each test.
  delete require.cache[require.resolve('../src/services/advancedAnalyticsService')];
  return require('../src/services/advancedAnalyticsService');
}

beforeEach(() => {
  jest.clearAllMocks();
  filterNonTerminatedUserIds.mockResolvedValue(['active-1', 'active-2']);
});

describe('advancedAnalyticsService', () => {
  test('project summary is backend-generated and scoped to non-terminated assigned users', async () => {
    query
      .mockResolvedValueOnce({ rows: taskColumns })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [
        { project_id: 'p1', project_name: 'Core', total_tasks: 4, completed_tasks: 2, open_tasks: 2, overdue_tasks: 1, high_priority_tasks: 1, completion_rate: 50 },
      ] });

    const service = loadService();
    const result = await service.getProjectSummary({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].project_name).toBe('Core');

    const sql = query.mock.calls[2][0];
    const params = query.mock.calls[2][1];
    expect(sql).toContain('LEFT JOIN projects p_analytics');
    expect(sql).toContain('t.assigned_to = ANY($2)');
    expect(sql).toContain('t.created_at >= NOW()');
    expect(sql).toContain('COUNT(*) FILTER');
    expect(params).toEqual(['org-1', ['active-1', 'active-2'], '30', ['completed', 'manager_approved']]);
  });

  test('project trend returns a generated date series per top project', async () => {
    query
      .mockResolvedValueOnce({ rows: taskColumns })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [
        { day: '2026-05-18', project_id: 'p1', project_name: 'Core', created: 2, completed: 1, overdue: 0 },
      ] });

    const service = loadService();
    const result = await service.getProjectTrend({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 14 });

    expect(result.points[0].project_id).toBe('p1');
    const sql = query.mock.calls[2][0];
    const params = query.mock.calls[2][1];
    expect(sql).toContain('generate_series');
    expect(sql).toContain('top_projects');
    expect(sql).toContain("date_trunc('day', t.created_at)");
    expect(sql).toContain("date_trunc('day', t.completed_at)");
    expect(sql).toContain("date_trunc('day', t.due_date)");
    expect(sql).toContain('t.assigned_to = ANY($2)');
    expect(params).toEqual(['org-1', ['active-1', 'active-2'], ['completed', 'manager_approved'], '14']);
  });

  test('department performance uses user departments and non-terminated employee scope', async () => {
    query
      .mockResolvedValueOnce({ rows: taskColumns })
      .mockResolvedValueOnce({ rows: userColumns })
      .mockResolvedValueOnce({ rows: [
        { department: 'Operations', employee_count: 2, assigned_tasks: 8, completed_tasks: 5, open_tasks: 3, overdue_tasks: 1, completion_rate: 62.5, avg_open_tasks: 1.5 },
      ] });

    const service = loadService();
    const result = await service.getDepartmentPerformance({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(result.departments[0].department).toBe('Operations');
    const sql = query.mock.calls[2][0];
    const params = query.mock.calls[2][1];
    expect(sql).toContain("COALESCE(NULLIF(u.department, ''), 'Unassigned')");
    expect(sql).toContain('LEFT JOIN tasks t ON t.assigned_to = u.id');
    expect(sql).toContain('u.id = ANY($2)');
    expect(sql).toContain('t.created_at >= NOW()');
    expect(params).toEqual(['org-1', ['active-1', 'active-2'], ['completed', 'manager_approved'], '30']);
  });

  test('employee trend builds a generated date series and respects employeeId filter', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce(['employee-1']);
    query
      .mockResolvedValueOnce({ rows: taskColumns })
      .mockResolvedValueOnce({ rows: [
        { day: '2026-05-18', employee_id: 'employee-1', employee_name: 'Active User', assigned: 1, completed: 1, overdue: 0 },
      ] });

    const service = loadService();
    const result = await service.getEmployeeTrend(
      { id: 'admin-1', org_id: 'org-1', role: 'admin' },
      { employeeId: 'employee-1', days: 7 }
    );

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', ['employee-1'], { requireActive: true });
    expect(result.points[0].employee_id).toBe('employee-1');
    const sql = query.mock.calls[1][0];
    const params = query.mock.calls[1][1];
    expect(sql).toContain('generate_series');
    expect(sql).toContain('CROSS JOIN employees');
    expect(sql).toContain('u.id = ANY($2)');
    expect(sql).toContain('t.assigned_to = e.employee_id');
    expect(params).toEqual(['org-1', ['employee-1'], ['completed', 'manager_approved'], '7']);
  });
});
