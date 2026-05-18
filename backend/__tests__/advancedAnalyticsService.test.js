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

const service = require('../src/services/advancedAnalyticsService');

function sqlOf(call) {
  return String(call?.[0] || '');
}

function hasQuery(pattern) {
  return query.mock.calls.some((candidate) => sqlOf(candidate).includes(pattern));
}

function mockAdvancedAnalyticsQueries({
  projectSummaryRows = [],
  projectTrendRows = [],
  departmentRows = [],
  employeeTrendRows = [],
} = {}) {
  query.mockImplementation(async (sql, params = []) => {
    const text = String(sql || '');

    if (text.includes('information_schema.columns')) {
      if (params[0] === 'users') return { rows: userColumns };
      return { rows: taskColumns };
    }

    if (text.includes('information_schema.tables')) {
      return { rows: [{ exists: true }] };
    }

    if (text.includes('project_status') && text.includes('FROM tasks')) {
      return { rows: projectSummaryRows };
    }

    if (text.includes('top_projects')) {
      return { rows: projectTrendRows };
    }

    if (text.includes('FROM users u') && text.includes('department')) {
      return { rows: departmentRows };
    }

    if (text.includes('CROSS JOIN employees') || text.includes('employee_tasks')) {
      return { rows: employeeTrendRows };
    }

    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  filterNonTerminatedUserIds.mockResolvedValue(['active-1', 'active-2']);
});

describe('advancedAnalyticsService', () => {
  test('project summary is backend-generated and scoped to non-terminated assigned users', async () => {
    mockAdvancedAnalyticsQueries({
      projectSummaryRows: [
        { project_id: 'p1', project_name: 'Core', total_tasks: 4, completed_tasks: 2, open_tasks: 2, overdue_tasks: 1, high_priority_tasks: 1, completion_rate: 50 },
      ],
    });

    const result = await service.getProjectSummary({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(result.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ project_id: 'p1', project_name: 'Core', total_tasks: 4 }),
    ]));
    expect(hasQuery('project_status')).toBe(true);
    expect(hasQuery('COUNT(*) FILTER')).toBe(true);
  });

  test('project trend returns a generated date series per top project', async () => {
    mockAdvancedAnalyticsQueries({
      projectTrendRows: [
        { day: '2026-05-18', project_id: 'p1', project_name: 'Core', created: 2, completed: 1, overdue: 0 },
      ],
    });

    const result = await service.getProjectTrend({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 14 });

    expect(result.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ project_id: 'p1', project_name: 'Core', created: 2 }),
    ]));
    expect(hasQuery('generate_series')).toBe(true);
    expect(hasQuery('top_projects')).toBe(true);
  });

  test('department performance uses user departments and non-terminated employee scope', async () => {
    mockAdvancedAnalyticsQueries({
      departmentRows: [
        { department: 'Operations', employee_count: 2, assigned_tasks: 8, completed_tasks: 5, open_tasks: 3, overdue_tasks: 1, completion_rate: 62.5, avg_open_tasks: 1.5 },
      ],
    });

    const result = await service.getDepartmentPerformance({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(result.departments).toEqual(expect.arrayContaining([
      expect.objectContaining({ department: 'Operations', assigned_tasks: 8 }),
    ]));
    expect(hasQuery('FROM users u')).toBe(true);
    expect(hasQuery('department')).toBe(true);
  });

  test('employee trend builds a generated date series and respects employeeId filter', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce(['employee-1']);
    mockAdvancedAnalyticsQueries({
      employeeTrendRows: [
        { day: '2026-05-18', employee_id: 'employee-1', employee_name: 'Active User', assigned: 1, completed: 1, overdue: 0 },
      ],
    });

    const result = await service.getEmployeeTrend(
      { id: 'admin-1', org_id: 'org-1', role: 'admin' },
      { employeeId: 'employee-1', days: 7 }
    );

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', ['employee-1'], { requireActive: true });
    expect(result.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ employee_id: 'employee-1', employee_name: 'Active User' }),
    ]));
    expect(hasQuery('generate_series')).toBe(true);
    expect(hasQuery('CROSS JOIN employees')).toBe(true);
  });
});
