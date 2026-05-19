jest.mock('../src/utils/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/employeeVisibility', () => ({
  filterNonTerminatedUserIds: jest.fn(),
}));

const { query } = require('../src/utils/db');
const { filterNonTerminatedUserIds } = require('../src/utils/employeeVisibility');
const service = require('../src/services/slaRiskAnalyticsService');

const taskColumns = [
  'id', 'title', 'org_id', 'assigned_to', 'project_id', 'category_id', 'status',
  'priority', 'created_at', 'updated_at', 'due_date',
].map(column_name => ({ column_name }));

function sqlOf(call) {
  return String(call?.[0] || '');
}

function hasQuery(pattern) {
  return query.mock.calls.some((candidate) => sqlOf(candidate).includes(pattern));
}

function findQuery(pattern) {
  return query.mock.calls.find((candidate) => sqlOf(candidate).includes(pattern));
}

function mockSlaQueries({ summaryRows = [], taskRows = [] } = {}) {
  query.mockImplementation(async (sql, params = []) => {
    const text = String(sql || '');
    if (text.includes('information_schema.columns')) return { rows: taskColumns };
    if (text.includes('COUNT(*) FILTER') && text.includes('open_tasks')) return { rows: summaryRows };
    if (text.includes('risk_tasks') && text.includes('risk_score')) return { rows: taskRows };
    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  filterNonTerminatedUserIds.mockResolvedValue(['active-1', 'active-2']);
});

describe('slaRiskAnalyticsService', () => {
  test('returns scoped SLA risk summary and task queue', async () => {
    mockSlaQueries({
      summaryRows: [{ open_tasks: 5, overdue_tasks: 1, due_soon_72h: 2, critical_priority_open: 1, stalled_pending: 1, review_backlog: 0 }],
      taskRows: [{ task_id: 't1', title: 'Fix pump', risk_score: 85, risk_reason: 'Overdue deadline' }],
    });

    const result = await service.getSlaRisk({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { days: 30 });

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(result.summary.open_tasks).toBe(5);
    expect(result.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ task_id: 't1', risk_score: 85 })]));
    expect(hasQuery('t.assigned_to = ANY($2)')).toBe(true);
    expect(hasQuery('COUNT(*) FILTER')).toBe(true);
    expect(hasQuery('ORDER BY risk_score DESC')).toBe(true);
  });

  test('employeeId filter scopes the SLA scan to that active employee only', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce(['employee-1']);
    mockSlaQueries({ summaryRows: [{ open_tasks: 1, overdue_tasks: 0, due_soon_72h: 1, critical_priority_open: 0, stalled_pending: 0, review_backlog: 0 }] });

    const result = await service.getSlaRisk(
      { id: 'admin-1', org_id: 'org-1', role: 'admin' },
      { employeeId: 'employee-1' }
    );

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', ['employee-1'], { requireActive: true });
    expect(result.summary.due_soon_72h).toBe(1);
    expect(hasQuery('t.assigned_to = ANY($2)')).toBe(true);
  });

  test('projectId filter is included when project columns exist', async () => {
    mockSlaQueries({ summaryRows: [{ open_tasks: 0, overdue_tasks: 0, due_soon_72h: 0, critical_priority_open: 0, stalled_pending: 0, review_backlog: 0 }] });

    await service.getSlaRisk({ id: 'admin-1', org_id: 'org-1', role: 'admin' }, { projectId: 'project-1' });

    const summaryCall = findQuery('COUNT(*) FILTER');
    expect(summaryCall?.[0]).toContain('t.project_id = $3');
    expect(summaryCall?.[1]).toEqual(['org-1', ['active-1', 'active-2'], 'project-1', ['completed', 'manager_approved', 'cancelled']]);
  });

  test('non-org-wide roles are scoped to self before terminated filtering', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce(['employee-self']);
    mockSlaQueries({ summaryRows: [{ open_tasks: 0, overdue_tasks: 0, due_soon_72h: 0, critical_priority_open: 0, stalled_pending: 0, review_backlog: 0 }] });

    await service.getSlaRisk({ id: 'employee-self', org_id: 'org-1', role: 'employee' }, {});

    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', ['employee-self'], { requireActive: true });
  });
});
