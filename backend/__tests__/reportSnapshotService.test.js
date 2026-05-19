jest.mock('../src/services/analyticsService', () => ({
  getSummary: jest.fn(),
  getEmployeePerformance: jest.fn(),
}));
jest.mock('../src/services/advancedAnalyticsService', () => ({
  getProjectSummary: jest.fn(),
  getDepartmentPerformance: jest.fn(),
}));
jest.mock('../src/services/slaRiskAnalyticsService', () => ({
  getSlaRisk: jest.fn(),
}));

const analyticsService = require('../src/services/analyticsService');
const advancedAnalyticsService = require('../src/services/advancedAnalyticsService');
const slaRiskAnalyticsService = require('../src/services/slaRiskAnalyticsService');
const { buildReportAnalyticsSnapshot } = require('../src/services/reportSnapshotService');

const user = { id: 'admin-1', org_id: 'org-1', role: 'admin' };
const periodStart = new Date('2026-05-01T00:00:00.000Z');
const periodEnd = new Date('2026-05-31T00:00:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
  analyticsService.getSummary.mockResolvedValue({ total_tasks: 10, completed_tasks: 7, pending_tasks: 2, overdue_tasks: 1, active_employees: 4 });
  analyticsService.getEmployeePerformance.mockResolvedValue({ employees: [{ employee_id: 'u1', employee_name: 'Active User', assigned: 5, completed: 4, overdue: 1 }] });
  advancedAnalyticsService.getProjectSummary.mockResolvedValue({ projects: [{ project_id: 'p1', project_name: 'Core', total_tasks: 8, completed_tasks: 6, open_tasks: 2, overdue_tasks: 1 }] });
  advancedAnalyticsService.getDepartmentPerformance.mockResolvedValue({ departments: [{ department: 'Operations', employee_count: 2, assigned_tasks: 8, completed_tasks: 6, open_tasks: 2, overdue_tasks: 1 }] });
  slaRiskAnalyticsService.getSlaRisk.mockResolvedValue({ summary: { open_tasks: 3, overdue_tasks: 1, due_soon_72h: 1, critical_priority_open: 0, stalled_pending: 0, review_backlog: 1 }, tasks: [{ task_id: 't1', title: 'Risk task', risk_score: 80 }] });
});

describe('reportSnapshotService', () => {
  test('builds a report analytics snapshot from backend analytics services', async () => {
    const snapshot = await buildReportAnalyticsSnapshot(user, { periodStart, periodEnd, reportType: 'monthly' });

    const expectedFilters = { from: periodStart, to: periodEnd, days: 30 };
    expect(analyticsService.getSummary).toHaveBeenCalledWith(user, expectedFilters);
    expect(advancedAnalyticsService.getProjectSummary).toHaveBeenCalledWith(user, expectedFilters);
    expect(advancedAnalyticsService.getDepartmentPerformance).toHaveBeenCalledWith(user, expectedFilters);
    expect(analyticsService.getEmployeePerformance).toHaveBeenCalledWith(user, expectedFilters);
    expect(slaRiskAnalyticsService.getSlaRisk).toHaveBeenCalledWith(user, expectedFilters);

    expect(snapshot.report_type).toBe('monthly');
    expect(snapshot.period.days).toBe(30);
    expect(snapshot.terminated_employee_exclusion.enabled).toBe(true);
    expect(snapshot.summary.total_tasks).toBe(10);
    expect(snapshot.project_summary.projects[0].project_name).toBe('Core');
    expect(snapshot.department_performance.departments[0].department).toBe('Operations');
    expect(snapshot.employee_performance.employees[0].employee_name).toBe('Active User');
    expect(snapshot.sla_risk.tasks[0].task_id).toBe('t1');
    expect(snapshot.errors).toEqual([]);
  });

  test('returns stable fallback shapes when one analytics source fails', async () => {
    advancedAnalyticsService.getProjectSummary.mockRejectedValueOnce(new Error('project analytics unavailable'));

    const snapshot = await buildReportAnalyticsSnapshot(user, { periodStart, periodEnd, reportType: 'weekly' });

    expect(snapshot.project_summary).toEqual({ projects: [] });
    expect(snapshot.summary.total_tasks).toBe(10);
    expect(snapshot.department_performance.departments).toHaveLength(1);
    expect(snapshot.employee_performance.employees).toHaveLength(1);
    expect(snapshot.sla_risk.tasks).toHaveLength(1);
    expect(snapshot.errors).toEqual(['project analytics unavailable']);
  });

  test('caps snapshot day window and defaults invalid periods safely', async () => {
    await buildReportAnalyticsSnapshot(user, {
      periodStart: new Date('2025-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      reportType: 'long_range',
    });
    expect(analyticsService.getSummary.mock.calls[0][1].days).toBe(365);

    jest.clearAllMocks();
    analyticsService.getSummary.mockResolvedValue({ total_tasks: 0 });
    analyticsService.getEmployeePerformance.mockResolvedValue({ employees: [] });
    advancedAnalyticsService.getProjectSummary.mockResolvedValue({ projects: [] });
    advancedAnalyticsService.getDepartmentPerformance.mockResolvedValue({ departments: [] });
    slaRiskAnalyticsService.getSlaRisk.mockResolvedValue({ summary: {}, tasks: [] });

    await buildReportAnalyticsSnapshot(user, {
      periodStart: new Date('2026-05-31T00:00:00.000Z'),
      periodEnd: new Date('2026-05-01T00:00:00.000Z'),
      reportType: 'invalid_range',
    });
    expect(analyticsService.getSummary.mock.calls[0][1].days).toBe(30);
  });
});
