jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({}) })),
}));
jest.mock('../src/utils/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/employeeVisibility', () => ({
  filterNonTerminatedUserIds: jest.fn(),
  safeSubordinateUserIds: jest.fn(),
}));
jest.mock('../src/services/reportSnapshotService', () => ({
  buildReportAnalyticsSnapshot: jest.fn(),
}));

const { query } = require('../src/utils/db');
const { filterNonTerminatedUserIds, safeSubordinateUserIds } = require('../src/utils/employeeVisibility');
const { buildReportAnalyticsSnapshot } = require('../src/services/reportSnapshotService');
const { generateReport } = require('../src/services/reportService');

const periodStart = new Date('2026-05-01T00:00:00.000Z');
const periodEnd = new Date('2026-05-31T00:00:00.000Z');
const analyticsSnapshot = {
  summary: { total_tasks: 4, completed_tasks: 3, overdue_tasks: 0, active_employees: 2 },
  project_summary: { projects: [{ project_id: 'p1', project_name: 'Core' }] },
  department_performance: { departments: [{ department: 'Operations' }] },
  employee_performance: { employees: [{ employee_id: 'active-1', employee_name: 'Active User' }] },
  sla_risk: { summary: { open_tasks: 1 }, tasks: [] },
  terminated_employee_exclusion: { enabled: true },
};

function sqlOf(sql) {
  return String(sql || '');
}

function findInsertCall() {
  return query.mock.calls.find(([sql]) => sqlOf(sql).includes('INSERT INTO reports'));
}

beforeEach(() => {
  jest.clearAllMocks();
  safeSubordinateUserIds.mockResolvedValue([]);
  filterNonTerminatedUserIds.mockResolvedValue(['active-1', 'active-2']);
  buildReportAnalyticsSnapshot.mockResolvedValue(analyticsSnapshot);
});

describe('reportService.generateReport', () => {
  test('embeds the backend analytics snapshot into generated report data', async () => {
    query.mockImplementation(async (sql) => {
      const text = sqlOf(sql);
      if (text.includes('SELECT id, full_name, email, role FROM users')) {
        return { rows: [{ id: 'admin-1', full_name: 'Admin User', email: 'admin@example.com', role: 'admin' }] };
      }
      if (text.includes('GROUP BY status')) {
        return { rows: [
          { status: 'completed', count: '3', avg_hours: 2 },
          { status: 'pending', count: '1', avg_hours: 1 },
        ] };
      }
      if (text.includes('SELECT t.title, t.due_date')) {
        return { rows: [] };
      }
      if (text.includes('FROM task_photos')) {
        return { rows: [{ approved: '2', rejected: '1', total: '3' }] };
      }
      if (text.includes('SELECT u.full_name, u.email')) {
        return { rows: [{ full_name: 'Active User', email: 'active@example.com', completed: '3', total: '4' }] };
      }
      if (text.includes('FROM projects p')) {
        return { rows: [{ project_id: 'p1', project_name: 'Core', project_status: 'active', total_tasks: 4, completed_tasks: 3, open_tasks: 1 }] };
      }
      if (text.includes('INSERT INTO reports')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const report = await generateReport('admin-1', 'org-1', periodStart, periodEnd, 'monthly');

    expect(buildReportAnalyticsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', org_id: 'org-1', role: 'admin' }),
      { periodStart, periodEnd, reportType: 'monthly' }
    );
    expect(filterNonTerminatedUserIds).toHaveBeenCalledWith('org-1', null, { requireActive: true });
    expect(report.analyticsSnapshot).toEqual(analyticsSnapshot);
    expect(report.projectBreakdown[0].project_name).toBe('Core');

    const insertCall = findInsertCall();
    expect(insertCall).toBeTruthy();
    const insertedPayload = JSON.parse(insertCall[1][6]);
    expect(insertedPayload.analyticsSnapshot).toEqual(analyticsSnapshot);
    expect(insertedPayload.analyticsSnapshot.terminated_employee_exclusion.enabled).toBe(true);
  });

  test('persists analytics snapshot even when no non-terminated target users are visible', async () => {
    filterNonTerminatedUserIds.mockResolvedValueOnce([]);
    query.mockImplementation(async (sql) => {
      const text = sqlOf(sql);
      if (text.includes('SELECT id, full_name, email, role FROM users')) {
        return { rows: [{ id: 'employee-1', full_name: 'Employee User', email: 'employee@example.com', role: 'employee' }] };
      }
      if (text.includes('INSERT INTO reports')) return { rows: [] };
      throw new Error(`Unexpected query: ${text}`);
    });

    const report = await generateReport('employee-1', 'org-1', periodStart, periodEnd, 'daily');

    expect(report.summary.total).toBe(0);
    expect(report.analyticsSnapshot).toEqual(analyticsSnapshot);
    const insertCall = findInsertCall();
    const insertedPayload = JSON.parse(insertCall[1][6]);
    expect(insertedPayload.analyticsSnapshot).toEqual(analyticsSnapshot);
    expect(insertedPayload.topPerformers).toEqual([]);
    expect(insertedPayload.projectBreakdown).toEqual([]);
  });
});
