'use strict';

const analyticsService = require('./analyticsService');
const advancedAnalyticsService = require('./advancedAnalyticsService');
const slaRiskAnalyticsService = require('./slaRiskAnalyticsService');

function periodDays(periodStart, periodEnd) {
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  return Math.max(1, Math.min(365, Math.ceil((end - start) / 86400000)));
}

function settledValue(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function settledError(result) {
  if (result.status !== 'rejected') return null;
  return result.reason?.message || String(result.reason || 'Unknown analytics snapshot error');
}

async function buildReportAnalyticsSnapshot(user, { periodStart, periodEnd, reportType } = {}) {
  const filters = {
    from: periodStart,
    to: periodEnd,
    days: periodDays(periodStart, periodEnd),
  };

  const results = await Promise.allSettled([
    analyticsService.getSummary(user, filters),
    advancedAnalyticsService.getProjectSummary(user, filters),
    advancedAnalyticsService.getDepartmentPerformance(user, filters),
    analyticsService.getEmployeePerformance(user, filters),
    slaRiskAnalyticsService.getSlaRisk(user, filters),
  ]);

  const errors = results.map(settledError).filter(Boolean);

  return {
    generated_at: new Date().toISOString(),
    report_type: reportType || 'on_demand',
    period: { start: periodStart, end: periodEnd, days: filters.days },
    terminated_employee_exclusion: {
      enabled: true,
      rule: 'Terminated employees are excluded from report charts, performance, workload, SLA risk, project, and department analytics.',
    },
    summary: settledValue(results[0], { total_tasks: 0, completed_tasks: 0, pending_tasks: 0, overdue_tasks: 0, active_employees: 0, avg_completion_hours: 0, avg_ai_confidence: 0 }),
    project_summary: settledValue(results[1], { projects: [] }),
    department_performance: settledValue(results[2], { departments: [] }),
    employee_performance: settledValue(results[3], { employees: [] }),
    sla_risk: settledValue(results[4], { summary: { open_tasks: 0, overdue_tasks: 0, due_soon_72h: 0, critical_priority_open: 0, stalled_pending: 0, review_backlog: 0 }, tasks: [] }),
    errors,
  };
}

module.exports = { buildReportAnalyticsSnapshot };
