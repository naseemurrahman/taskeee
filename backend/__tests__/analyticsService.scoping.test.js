jest.mock('../src/utils/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/employeeVisibility', () => ({
  filterNonTerminatedUserIds: jest.fn(),
}));

const { query } = require('../src/utils/db');
const { filterNonTerminatedUserIds } = require('../src/utils/employeeVisibility');

function loadService() {
  jest.resetModules();
  return require('../src/services/analyticsService');
}

const allTaskColumns = [
  'id', 'org_id', 'assigned_to', 'status', 'priority', 'created_at',
  'updated_at', 'completed_at', 'due_date', 'category_id', 'ai_confidence_score',
].map(column_name => ({ column_name }));

beforeEach(() => {
  jest.clearAllMocks();
  filterNonTerminatedUserIds.mockResolvedValue(['active-1', 'active-2']);
});

describe('analyticsService scoping and live chart data', () => {
  test('summary only counts tasks assigned to non-terminated scoped users', async () => {
    query
      .mockResolvedValueOnce({ rows: allTaskColumns })
      .mockResolvedValueOnce({ rows: [{
        total_tasks: 3,
        completed_tasks: 1,
        pending_tasks: 2,
        overdue_tasks: 1,
        active_employees: 2,
        avg_completion_hours: '2.5',
        avg_ai_confidence: '0.88',
      }] });

    const service = loadService();
    const result = await service.getSummary({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(result.total_tasks).toBe(3);
    expect(query.mock.calls[1][0]).toContain('t.assigned_to = ANY($2)');
    expect(query.mock.calls[1][1]).toEqual(['org-1', ['active-1', 'active-2'], ['completed', 'manager_approved']]);
  });

  test('tasks-over-time returns a generated date series and uses correct source dates', async () => {
    query
      .mockResolvedValueOnce({ rows: allTaskColumns })
      .mockResolvedValueOnce({ rows: [
        { day: '2026-05-17', created: 2, completed: 1, overdue: 0 },
        { day: '2026-05-18', created: 0, completed: 0, overdue: 1 },
      ] });

    const service = loadService();
    const result = await service.getTasksOverTime({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 7 });

    expect(result.points).toHaveLength(2);
    const sql = query.mock.calls[1][0];
    expect(sql).toContain('generate_series');
    expect(sql).toContain("date_trunc('day', t.created_at)");
    expect(sql).toContain("date_trunc('day', t.completed_at)");
    expect(sql).toContain("date_trunc('day', t.due_date)");
    expect(sql).toContain('t.assigned_to = ANY($2)');
  });

  test('priority breakdown is backend-generated from live task priority records', async () => {
    query
      .mockResolvedValueOnce({ rows: allTaskColumns })
      .mockResolvedValueOnce({ rows: [
        { priority: 'critical', count: 1 },
        { priority: 'high', count: 2 },
      ] });

    const service = loadService();
    const result = await service.getPriorityBreakdown({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(result.priorities).toEqual([
      { priority: 'critical', count: 1 },
      { priority: 'high', count: 2 },
    ]);
    expect(query.mock.calls[1][0]).toContain('LOWER(COALESCE(t.priority');
    expect(query.mock.calls[1][0]).toContain('GROUP BY 1');
    expect(query.mock.calls[1][0]).toContain('t.assigned_to = ANY($2)');
  });

  test('employee analytics are personal for manager/supervisor roles unless org-wide', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce(['manager-1']);
    query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: allTaskColumns })
      .mockResolvedValueOnce({ rows: [{ employee_id: 'manager-1', employee_name: 'Manager', assigned: 1, completed: 1, overdue: 0 }] });

    const service = loadService();
    const result = await service.getEmployeePerformance({ id: 'manager-1', org_id: 'org-1', role: 'manager', email: 'm@example.com' }, { days: 30 });

    expect(result.employees[0].employee_id).toBe('manager-1');
    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', ['manager-1'], { requireActive: true });
    expect(query.mock.calls.at(-1)[0]).toContain('u.id = ANY');
  });
});
