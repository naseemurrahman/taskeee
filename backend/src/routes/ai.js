'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../utils/db');
const analyticsService = require('../services/analyticsService');

const COMPLETED = ['completed', 'manager_approved'];

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function severity(score) {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function daysUntil(value) {
  if (!value) return null;
  const due = new Date(value).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.ceil((due - Date.now()) / (24 * 60 * 60 * 1000));
}

function filters(req) {
  return { days: req.query.days || 30 };
}

async function getTaskColumns() {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks'`
  );
  return new Set(rows.map((r) => r.column_name));
}

function has(columns, name) {
  return columns.has(name);
}

async function loadOpenTasks(user, limit = 30) {
  const columns = await getTaskColumns();
  const select = [
    has(columns, 'id') ? 't.id' : 'NULL AS id',
    has(columns, 'title') ? 't.title' : `'Untitled task' AS title`,
    has(columns, 'status') ? 't.status' : `'unknown' AS status`,
    has(columns, 'priority') ? 't.priority' : `'medium' AS priority`,
    has(columns, 'due_date') ? 't.due_date' : 'NULL::timestamp AS due_date',
    has(columns, 'created_at') ? 't.created_at' : 'NULL::timestamp AS created_at',
    has(columns, 'assigned_to') ? 't.assigned_to' : 'NULL AS assigned_to',
    has(columns, 'ai_confidence_score') ? 't.ai_confidence_score' : 'NULL::numeric AS ai_confidence_score',
    'COALESCE(u.full_name, u.email, NULL) AS assigned_to_name',
  ];
  const where = [];
  const values = [];
  if (has(columns, 'org_id') && user?.org_id) {
    values.push(user.org_id);
    where.push(`t.org_id = $${values.length}`);
  }
  if (has(columns, 'status')) where.push(`t.status NOT IN ('completed', 'manager_approved', 'cancelled')`);
  values.push(limit);
  const limitParam = values.length;

  const join = has(columns, 'assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : 'LEFT JOIN users u ON FALSE';
  const order = has(columns, 'due_date') ? 'ORDER BY t.due_date NULLS LAST, t.created_at DESC NULLS LAST' : 'ORDER BY t.created_at DESC NULLS LAST';
  const { rows } = await query(
    `SELECT ${select.join(', ')}
     FROM tasks t
     ${join}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ${order}
     LIMIT $${limitParam}`,
    values
  );
  return rows;
}

function scoreTask(task, workloadByUser = new Map()) {
  const days = daysUntil(task.due_date);
  const isOverdue = days !== null && days < 0;
  const dueSoon = days !== null && days <= 2;
  const priority = String(task.priority || '').toLowerCase();
  const workload = task.assigned_to ? Number(workloadByUser.get(String(task.assigned_to)) || 0) : 0;
  const confidence = task.ai_confidence_score == null ? null : Number(task.ai_confidence_score);

  let score = 10;
  if (isOverdue) score += 50;
  else if (dueSoon) score += 28;
  else if (days !== null && days <= 5) score += 16;
  if (['urgent', 'critical'].includes(priority)) score += 20;
  else if (priority === 'high') score += 14;
  if (!task.assigned_to) score += 18;
  if (workload >= 8) score += 12;
  if (confidence !== null && confidence < 0.55) score += 10;

  const finalScore = clamp(score);
  const reasons = [];
  if (isOverdue) reasons.push(`${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`);
  else if (dueSoon) reasons.push(days === 0 ? 'due today' : `due in ${days} day${days === 1 ? '' : 's'}`);
  if (['high', 'urgent', 'critical'].includes(priority)) reasons.push(`${priority} priority`);
  if (!task.assigned_to) reasons.push('unassigned');
  if (workload >= 8) reasons.push(`owner has ${workload} open tasks`);
  if (confidence !== null && confidence < 0.55) reasons.push('low AI confidence');
  if (!reasons.length) reasons.push('normal operational risk');

  let suggestion = 'Monitor during the next planning review.';
  if (isOverdue) suggestion = 'Escalate owner update and split or reassign blocked work.';
  else if (!task.assigned_to) suggestion = 'Assign an owner before the next work cycle.';
  else if (workload >= 8) suggestion = 'Reassign part of the workload to an underutilized teammate.';
  else if (dueSoon) suggestion = 'Confirm progress today and reduce scope if needed.';

  return {
    task_id: task.id,
    title: task.title,
    assigned_to: task.assigned_to,
    assigned_to_name: task.assigned_to_name,
    due_date: task.due_date,
    status: task.status,
    priority: task.priority,
    risk_score: finalScore,
    severity: severity(finalScore),
    reason: reasons.join(', '),
    suggestion,
  };
}

async function buildIntelligence(user, reqFilters = {}) {
  const [summary, trendData, employeeData, workloadData, openTasks] = await Promise.all([
    analyticsService.getSummary(user, reqFilters),
    analyticsService.getTasksOverTime(user, reqFilters),
    analyticsService.getEmployeePerformance(user, reqFilters),
    analyticsService.getWorkload(user, reqFilters),
    loadOpenTasks(user, 40),
  ]);

  const trend = trendData.points || [];
  const employees = employeeData.employees || [];
  const workloadEmployees = workloadData.employees || [];
  const total = Number(summary.total_tasks || 0);
  const completed = Number(summary.completed_tasks || 0);
  const pending = Number(summary.pending_tasks || 0);
  const overdue = Number(summary.overdue_tasks || 0);
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const overdueRate = total ? Math.round((overdue / total) * 100) : 0;
  const rawConfidence = summary.avg_ai_confidence;
  const confidenceAvailable = rawConfidence !== null && rawConfidence !== undefined && Number(rawConfidence) > 0;
  const avgConfidence = confidenceAvailable ? Number(rawConfidence) : null;

  const openCounts = new Map(workloadEmployees.map((e) => [String(e.employee_id), Number(e.open_tasks || 0)]));
  const scoredTasks = openTasks.map((task) => scoreTask(task, openCounts)).sort((a, b) => b.risk_score - a.risk_score);
  const latest = trend.slice(-7);
  const recentCreated = latest.reduce((s, p) => s + Number(p.created || 0), 0);
  const recentCompleted = latest.reduce((s, p) => s + Number(p.completed || 0), 0);
  const backlogVelocityGap = Math.max(0, recentCreated - recentCompleted);
  const avgOpen = workloadEmployees.length
    ? workloadEmployees.reduce((s, e) => s + Number(e.open_tasks || 0), 0) / workloadEmployees.length
    : 0;
  const overloaded = workloadEmployees.filter((e) => Number(e.open_tasks || 0) > Math.max(5, avgOpen * 1.5));
  const underutilized = workloadEmployees.filter((e) => Number(e.open_tasks || 0) <= Math.max(1, avgOpen * 0.35));

  const deliveryPressure = clamp(overdueRate * 1.2 + backlogVelocityGap * 8 + Math.max(0, 75 - completionRate) * 0.7);
  const workloadPressure = clamp(overloaded.length * 22 + Math.max(0, avgOpen - 4) * 8);
  const aiConfidenceRisk = confidenceAvailable ? clamp(Math.max(0, 0.78 - avgConfidence) * 130) : 0;

  const predictive_risks = [
    {
      title: 'Deadline risk prediction',
      detail: `${overdue} overdue tasks, ${pending} open tasks, and ${backlogVelocityGap} net new tasks in the recent trend window.`,
      score: deliveryPressure,
      severity: severity(deliveryPressure),
      action: deliveryPressure >= 65 ? 'Freeze low-priority intake and focus the team on overdue/high-risk tasks.' : 'Maintain current execution cadence and monitor overdue trend daily.',
    },
    {
      title: 'Capacity risk prediction',
      detail: `${overloaded.length} overloaded people, ${underutilized.length} underutilized people, ${avgOpen.toFixed(1)} average open tasks/person.`,
      score: workloadPressure,
      severity: severity(workloadPressure),
      action: workloadPressure >= 65 ? 'Rebalance tasks from overloaded users to underutilized users before assigning new work.' : 'Capacity is acceptable; keep workload distribution visible during planning.',
    },
    {
      title: 'AI confidence risk',
      detail: confidenceAvailable ? `Average AI confidence is ${Math.round(avgConfidence * 100)}%.` : 'AI confidence data is not yet available for this period.',
      score: aiConfidenceRisk,
      severity: confidenceAvailable ? severity(aiConfidenceRisk) : 'low',
      action: confidenceAvailable && aiConfidenceRisk >= 40 ? 'Review low-confidence AI decisions manually and add task context before automation.' : 'No AI-confidence alarm. Continue collecting confidence signals.',
    },
  ];

  const performanceRows = employees.map((e) => {
    const assigned = Number(e.assigned || 0);
    const done = Number(e.completed || 0);
    const late = Number(e.overdue || 0);
    const score = assigned ? Math.max(0, Math.round((done / assigned) * 100 - (late / assigned) * 35)) : 0;
    return { name: e.employee_name || 'Unassigned', active: Math.max(0, assigned - done), completed: done, performanceScore: score };
  });
  const strongest = performanceRows.slice().sort((a, b) => b.performanceScore - a.performanceScore)[0];
  const lowPerformers = performanceRows.filter((r) => r.performanceScore < 60 && (r.active || r.completed)).slice(0, 3);

  const suggestions = [
    overdue > 0 ? `Escalate ${overdue} overdue task${overdue === 1 ? '' : 's'} and require owner updates before end of day.` : 'No overdue escalation needed right now.',
    scoredTasks[0] ? `Prioritize "${scoredTasks[0].title}" first; risk score ${scoredTasks[0].risk_score}%.` : 'No high-risk task detected in the current open task set.',
    overloaded.length > 0 ? `Move 1-2 open tasks from overloaded people before creating more assignments.` : 'Workload distribution is currently stable.',
    strongest ? `Use ${strongest.name} as a template owner for similar work; current delivery score is ${strongest.performanceScore}%.` : 'Assign owners consistently so employee-level recommendations become stronger.',
    lowPerformers.length > 0 ? `Coach ${lowPerformers.map((p) => p.name).join(', ')} with smaller task batches and clearer due dates.` : 'No low delivery-score coaching signal detected.',
  ];

  const redistribution = overloaded.slice(0, 3).map((from, index) => {
    const to = underutilized[index % Math.max(underutilized.length, 1)];
    return {
      from: from.employee_name || 'Overloaded owner',
      to: to?.employee_name || 'next available owner',
      from_employee_id: from.employee_id,
      to_employee_id: to?.employee_id || null,
      tasks: Math.max(1, Math.min(3, Math.round((Number(from.open_tasks || 0) - avgOpen) / 2))),
      reason: `${from.employee_name || 'This owner'} has ${from.open_tasks} open tasks versus ${avgOpen.toFixed(1)} team average.`,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    summary: { total, completed, pending, overdue, completion_rate: completionRate, overdue_rate: overdueRate, avg_open_tasks: Number(avgOpen.toFixed(2)), confidence_available: confidenceAvailable },
    predictive_risks,
    risk_tasks: scoredTasks.slice(0, 10),
    suggestions,
    workload_redistribution: redistribution,
    data_quality: { confidence_available: confidenceAvailable, open_tasks_scored: scoredTasks.length },
  };
}

router.use(authenticate);

router.get('/predictive-overview', async (req, res, next) => {
  try {
    res.json(await buildIntelligence(req.user, filters(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/risk-tasks', async (req, res, next) => {
  try {
    const data = await buildIntelligence(req.user, filters(req));
    res.json({ generated_at: data.generated_at, tasks: data.risk_tasks });
  } catch (err) {
    next(err);
  }
});

router.get('/suggestions', async (req, res, next) => {
  try {
    const data = await buildIntelligence(req.user, filters(req));
    res.json({ generated_at: data.generated_at, suggestions: data.suggestions });
  } catch (err) {
    next(err);
  }
});

router.get('/workload-optimization', async (req, res, next) => {
  try {
    const data = await buildIntelligence(req.user, filters(req));
    res.json({ generated_at: data.generated_at, recommendations: data.workload_redistribution });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/ai/chat — proxy to Anthropic, keeps API key server-side
router.post('/chat', async (req, res, next) => {
  try {
    const { messages, context } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI service not configured. Set ANTHROPIC_API_KEY in Railway environment variables.' });
    }

    // Build live org context from DB
    const orgId = req.user.org_id || req.user.orgId;
    let orgContext = context || {};

    try {
      const [taskRes, projectRes, leaderRes] = await Promise.all([
        query(`SELECT id, title, status, priority, assigned_to_name, due_date FROM tasks WHERE org_id = $1 AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 50`, [orgId]),
        query(`SELECT id, name, status FROM projects WHERE org_id = $1 LIMIT 20`, [orgId]).catch(() => ({ rows: [] })),
        query(`SELECT u.id, u.full_name as name, COUNT(t.id) as total, COUNT(CASE WHEN t.status IN ('completed','manager_approved') THEN 1 END) as completed, COUNT(CASE WHEN t.status = 'overdue' THEN 1 END) as overdue FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id AND t.org_id = $1 WHERE u.org_id = $1 AND u.is_active = true GROUP BY u.id LIMIT 10`, [orgId]).catch(() => ({ rows: [] })),
      ]);
      orgContext.tasks = taskRes.rows;
      orgContext.projects = projectRes.rows;
      orgContext.leaderboard = leaderRes.rows;
    } catch (_e) {
      // DB context optional — still proceed with AI
    }

    // Build system prompt with live data
    const tasks = orgContext.tasks || [];
    const counts = { total: tasks.length, overdue: 0, pending: 0, in_progress: 0, completed: 0, submitted: 0 };
    for (const t of tasks) {
      if (t.status === 'overdue') counts.overdue++;
      else if (t.status === 'pending') counts.pending++;
      else if (t.status === 'in_progress') counts.in_progress++;
      else if (t.status === 'completed' || t.status === 'manager_approved') counts.completed++;
      else if (t.status === 'submitted') counts.submitted++;
    }
    const overdueList = tasks.filter(t => t.status === 'overdue').slice(0, 8)
      .map(t => `"${t.title}" (${t.assigned_to_name || 'unassigned'}) [ID:${String(t.id).slice(0,8)}]`).join('; ');

    const lb = (orgContext.leaderboard || []).slice(0, 5)
      .map(u => `${u.name}: ${u.completed}/${u.total} done, ${u.overdue} overdue`).join('; ');

    const systemPrompt = `You are JecZone AI, the intelligent assistant for TaskFlow Pro — an AI-powered task management platform.

LIVE ORGANIZATION DATA (as of right now):
- Tasks: ${counts.total} total | ${counts.overdue} overdue | ${counts.pending} pending | ${counts.in_progress} in-progress | ${counts.submitted} submitted | ${counts.completed} completed
- Projects: ${(orgContext.projects || []).map(p => p.name).join(', ') || 'none'}
- Overdue tasks: ${overdueList || 'none'}
- Team: ${lb || 'no data'}

When suggesting status changes, use this format so users can click Apply:
[ACTION: CHANGE_STATUS task_id="<first-8-chars-of-id>" to="<status>"]

Valid statuses: pending, in_progress, submitted, manager_approved, manager_rejected, completed, cancelled

Be concise, specific, and data-driven. Reference task names and assignees. Suggest concrete next steps.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      return res.status(anthropicRes.status).json({
        error: err?.error?.message || `Anthropic API error: ${anthropicRes.status}`
      });
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'Empty response from AI' });

    res.json({ text });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
