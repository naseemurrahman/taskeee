const analyticsService = require('./analyticsService');

function pct(part, total) {
  if (!total) return 0;
  return Math.round((Number(part || 0) / Number(total || 0)) * 100);
}

function severity(score) {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function insight(id, type, title, description, score, recommendation, meta = {}) {
  return {
    id,
    type,
    title,
    description,
    severity: severity(score),
    score,
    recommendation,
    meta,
  };
}

async function getOverview(user, filters = {}) {
  const [summary, status, workload, employeePerformance, aiConfidence, aiValidation] = await Promise.all([
    analyticsService.getSummary(user, filters),
    analyticsService.getTaskStatus(user, filters),
    analyticsService.getWorkload(user, filters),
    analyticsService.getEmployeePerformance(user, filters),
    analyticsService.getAiConfidence(user, filters),
    analyticsService.getAiValidation(user, filters),
  ]);

  const total = Number(summary.total_tasks || 0);
  const completed = Number(summary.completed_tasks || 0);
  const overdue = Number(summary.overdue_tasks || 0);
  const pending = Number(summary.pending_tasks || 0);
  const completionRate = pct(completed, total);
  const overdueRate = pct(overdue, total);
  const avgConfidence = Number(aiConfidence.average || summary.avg_ai_confidence || 0);
  const employees = workload.employees || [];
  const perf = employeePerformance.employees || [];
  const avgOpen = employees.length
    ? employees.reduce((sum, row) => sum + Number(row.open_tasks || 0), 0) / employees.length
    : 0;
  const overloaded = employees.filter((row) => Number(row.open_tasks || 0) > Math.max(5, avgOpen * 1.5));
  const underutilized = employees.filter((row) => Number(row.open_tasks || 0) <= Math.max(1, avgOpen * 0.35));

  const insights = [];

  if (overdue > 0) {
    insights.push(insight(
      'overdue-risk',
      'risk',
      'Overdue work needs intervention',
      `${overdue} of ${total} tasks are currently overdue (${overdueRate}%).`,
      Math.min(100, overdueRate * 2 + overdue),
      'Review overdue tasks, reassign blocked work, and escalate high-priority items.',
      { overdue, total, overdueRate }
    ));
  }

  if (completionRate < 60 && total > 5) {
    insights.push(insight(
      'low-completion-rate',
      'performance',
      'Completion rate is below target',
      `Current completion rate is ${completionRate}%, with ${pending} tasks still pending.`,
      70 - completionRate,
      'Reduce active work in progress and focus the team on closing existing tasks.',
      { completionRate, pending }
    ));
  }

  if (overloaded.length > 0) {
    insights.push(insight(
      'workload-imbalance',
      'workload',
      'Workload imbalance detected',
      `${overloaded.length} team member(s) are carrying substantially more open work than average.`,
      Math.min(100, overloaded.length * 18 + avgOpen * 4),
      'Move lower-priority work from overloaded employees to available team members.',
      { averageOpenTasks: Number(avgOpen.toFixed(2)), overloaded, underutilized }
    ));
  }

  if (avgConfidence > 0 && avgConfidence < 0.65) {
    insights.push(insight(
      'ai-confidence-low',
      'quality',
      'AI confidence is low',
      `Average AI confidence is ${Math.round(avgConfidence * 100)}%.`,
      Math.round((0.65 - avgConfidence) * 100),
      'Route low-confidence validations to manager review before approval.',
      { average: avgConfidence, buckets: aiConfidence }
    ));
  }

  const weakPerformers = perf
    .filter((row) => Number(row.assigned || 0) >= 3)
    .map((row) => {
      const assigned = Number(row.assigned || 0);
      const done = Number(row.completed || 0);
      const late = Number(row.overdue || 0);
      return {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        assigned,
        completed: done,
        overdue: late,
        completionRate: pct(done, assigned),
        riskScore: Math.min(100, pct(late, assigned) + Math.max(0, 70 - pct(done, assigned))),
      };
    })
    .filter((row) => row.riskScore >= 35)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  if (weakPerformers.length > 0) {
    insights.push(insight(
      'employee-delivery-risk',
      'people',
      'Employee delivery risk detected',
      `${weakPerformers.length} employee(s) show elevated delivery risk based on completion and overdue ratio.`,
      weakPerformers[0].riskScore,
      'Check blockers with these employees and rebalance work where necessary.',
      { employees: weakPerformers }
    ));
  }

  const validationUnknown = (aiValidation.statuses || []).find((row) => String(row.status).toLowerCase() === 'unknown');
  if (validationUnknown && Number(validationUnknown.count || 0) > 0) {
    insights.push(insight(
      'ai-validation-gaps',
      'quality',
      'AI validation data has gaps',
      `${validationUnknown.count} task(s) have unknown validation status.`,
      Math.min(70, Number(validationUnknown.count || 0) * 8),
      'Normalize validation statuses so analytics can separate accepted, rejected, and review-needed work.',
      { unknown: Number(validationUnknown.count || 0) }
    ));
  }

  insights.sort((a, b) => b.score - a.score);

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_tasks: total,
      completed_tasks: completed,
      pending_tasks: pending,
      overdue_tasks: overdue,
      completion_rate: completionRate,
      overdue_rate: overdueRate,
      average_ai_confidence: avgConfidence,
      average_open_tasks: Number(avgOpen.toFixed(2)),
    },
    insights,
  };
}

module.exports = { getOverview };
