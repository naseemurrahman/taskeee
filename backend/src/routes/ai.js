'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../utils/db');
const analyticsService = require('../services/analyticsService');
const { extractSignals, buildSafeSystemPrompt, logAIRecommendation } = require('../services/aiSafetyService');

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


// ────────────────────────────────────────────────────────────────────────────
// enhanceWithAI — sends computed signals to Groq (free) or Anthropic for real
// LLM-powered suggestions/insights. Falls back to rule-based if no key set.
// Returns { ai_model, ai_suggestions, ai_insights, ai_generated_at }
// ────────────────────────────────────────────────────────────────────────────
async function enhanceWithAI(intelligence, user) {
  const groqKey      = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!groqKey && !anthropicKey) {
    return { ai_model: 'rule-based', ai_suggestions: intelligence.suggestions, ai_insights: [], ai_generated_at: intelligence.generated_at };
  }

  const s = intelligence.summary;
  const risks = intelligence.predictive_risks || [];
  const topTasks = (intelligence.risk_tasks || []).slice(0, 5).map(t =>
    `"${t.title}" (risk ${t.risk_score}%, ${t.reason})`).join('; ');
  const redistSummary = (intelligence.workload_redistribution || []).slice(0, 3).map(r =>
    `${r.from} → ${r.to}: ${r.tasks} tasks — ${r.reason}`).join('; ');

  const systemPrompt = `You are an AI operations analyst for a task management platform. Analyze the live data and return ONLY a JSON object (no markdown fences, no explanation) with this exact shape:
{"suggestions":["string","string","string","string","string"],"insights":[{"title":"string","description":"string","severity":"low|medium|high|critical","recommendation":"string","evidence":"string"}]}
Every suggestion and insight must cite specific numbers from the data. Do not use generic advice.`;

  const userPrompt = `Live org data right now:
Tasks: ${s.total} total, ${s.completed} completed (${s.completion_rate}%), ${s.overdue} overdue (${s.overdue_rate}%), ${s.pending} pending
Avg open tasks/person: ${s.avg_open_tasks}
Risks: ${risks.map(r => `${r.title} score=${r.score}% (${r.severity})`).join('; ')}
Top risk tasks: ${topTasks || 'none'}
Redistribution moves: ${redistSummary || 'workload balanced'}
User role: ${user.role}

Give 5 specific suggestions and 3 insight cards.`;

  // Try Groq first (free, fast)
  if (groqKey) {
    try {
      const text = await callGroq(groqKey, systemPrompt, userPrompt);
      const parsed = extractJSON(text);
      if (parsed && Array.isArray(parsed.suggestions) && Array.isArray(parsed.insights)) {
        return { ai_model: 'groq-llama3', ai_suggestions: parsed.suggestions.slice(0, 5), ai_insights: parsed.insights.slice(0, 6), ai_generated_at: new Date().toISOString() };
      }
      console.warn('[AI] Groq returned non-JSON or wrong shape:', text?.slice(0, 200));
    } catch (err) {
      console.warn('[AI] Groq enhance failed:', err.message);
    }
  }

  // Try Anthropic
  if (anthropicKey) {
    try {
      const text = await callAnthropic(anthropicKey, systemPrompt, userPrompt);
      const parsed = extractJSON(text);
      if (parsed && Array.isArray(parsed.suggestions) && Array.isArray(parsed.insights)) {
        return { ai_model: 'claude-sonnet', ai_suggestions: parsed.suggestions.slice(0, 5), ai_insights: parsed.insights.slice(0, 6), ai_generated_at: new Date().toISOString() };
      }
      console.warn('[AI] Anthropic returned non-JSON or wrong shape:', text?.slice(0, 200));
    } catch (err) {
      console.warn('[AI] Anthropic enhance failed:', err.message);
    }
  }

  return { ai_model: 'rule-based', ai_suggestions: intelligence.suggestions, ai_insights: [], ai_generated_at: intelligence.generated_at };
}

// Robustly extract JSON from LLM output (handles markdown fences and stray text)
function extractJSON(text) {
  if (!text) return null;
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch {}
  // Strip markdown fences
  const stripped = text.replace(/```json|```/gi, '').trim();
  try { return JSON.parse(stripped); } catch {}
  // Find first { ... } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function callGroq(key, systemPrompt, userPrompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1200,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content || '';
}

async function callAnthropic(key, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const d = await res.json();
  return d.content?.[0]?.text || '';
}

router.use(authenticate);

// GET /api/v1/ai/status — returns which AI provider is configured
router.get('/status', async (req, res) => {
  const hasGroq      = !!process.env.GROQ_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const activeModel  = hasGroq ? 'groq-llama3' : hasAnthropic ? 'claude-sonnet' : 'rule-based';
  res.json({ active_model: activeModel, groq: hasGroq, anthropic: hasAnthropic });
});

router.get('/predictive-overview', async (req, res, next) => {
  try {
    const data = await buildIntelligence(req.user, filters(req));

    // ── Try to enhance suggestions/insights with real LLM analysis ──────────
    const enhanced = await enhanceWithAI(data, req.user);
    res.json({ ...data, ...enhanced });
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
    const enhanced = await enhanceWithAI(data, req.user);
    res.json({
      generated_at: enhanced.ai_generated_at || data.generated_at,
      ai_model: enhanced.ai_model,
      suggestions: enhanced.ai_suggestions || data.suggestions,
    });
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

    // Build live org context from DB regardless of whether Anthropic key is available
    const orgId = req.user.org_id || req.user.orgId;
    let orgContext = context || {};

    try {
      const [taskRes, projectRes, leaderRes] = await Promise.all([
        query(`SELECT id, title, status, priority, assigned_to_name, due_date FROM tasks WHERE org_id = $1 AND status NOT IN ('cancelled') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`, [orgId]),
        query(`SELECT id, name, status FROM projects WHERE org_id = $1 LIMIT 20`, [orgId]).catch(() => ({ rows: [] })),
        query(`SELECT u.id, u.full_name as name, COUNT(t.id) as total, COUNT(CASE WHEN t.status IN ('completed','manager_approved') THEN 1 END) as completed, COUNT(CASE WHEN t.status = 'overdue' THEN 1 END) as overdue FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id AND t.org_id = $1 WHERE u.org_id = $1 AND u.is_active = true GROUP BY u.id LIMIT 10`, [orgId]).catch(() => ({ rows: [] })),
      ]);
      orgContext.tasks = taskRes.rows;
      orgContext.projects = projectRes.rows;
      orgContext.leaderboard = leaderRes.rows;
    } catch (_e) {
      // DB context optional — still proceed
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;


    // ── No Anthropic key: try Groq free tier, then fall back to static summary ──
    if (!apiKey) {
      const groqKey = process.env.GROQ_API_KEY;
      const orgTasks = orgContext.tasks || [];
      const orgCounts = { total: orgTasks.length, overdue: 0, pending: 0, in_progress: 0, completed: 0, submitted: 0 };
      for (const t of orgTasks) {
        if (t.status === 'overdue') orgCounts.overdue++;
        else if (t.status === 'pending') orgCounts.pending++;
        else if (t.status === 'in_progress') orgCounts.in_progress++;
        else if (t.status === 'completed' || t.status === 'manager_approved') orgCounts.completed++;
        else if (t.status === 'submitted') orgCounts.submitted++;
      }
      const orgOverdueList = orgTasks.filter(t => t.status === 'overdue').slice(0, 8)
        .map(t => `"${t.title}" (${t.assigned_to_name || 'unassigned'})`).join('; ');
      const orgLb = (orgContext.leaderboard || []).slice(0, 5)
        .map(u => `${u.name}: ${u.completed}/${u.total} done, ${u.overdue} overdue`).join('; ');
      const orgProjects = (orgContext.projects || []).map(p => p.name).join(', ') || 'none';

      const groqSystemPrompt = `You are JecZone AI, intelligent assistant for TaskFlow Pro — an AI-powered task management platform.

LIVE ORG DATA:
- Tasks: ${orgCounts.total} total | ${orgCounts.completed} completed | ${orgCounts.in_progress} in progress | ${orgCounts.submitted} submitted | ${orgCounts.overdue} overdue
- Overdue: ${orgOverdueList || 'none'}
- Team performance: ${orgLb || 'no data'}
- Active projects: ${orgProjects}

Be concise, actionable, and data-driven. Format responses with markdown. Always reference specific numbers from the live data above.`;

      if (groqKey) {
        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              max_tokens: 1000,
              messages: [
                { role: 'system', content: groqSystemPrompt },
                ...messages.map(m => ({ role: m.role, content: m.content })),
              ],
            }),
          });
          if (groqRes.ok) {
            const groqData = await groqRes.json();
            const text = groqData.choices?.[0]?.message?.content;
            if (text) return res.json({ text, model: 'groq-llama3' });
          }
        } catch (groqErr) {
          console.warn('[AI] Groq failed:', groqErr);
        }
      }

      const completionRate = orgCounts.total ? Math.round((orgCounts.completed / orgCounts.total) * 100) : 0;
      const fallbackText =
        `💡 **Enable free AI:** Add \`GROQ_API_KEY\` in Railway → Variables (free at console.groq.com) — powers JecZone AI with Llama 3.3 70B at no cost.\n\n` +
        `**Live org snapshot (${orgCounts.total} tasks):**\n` +
        `✅ ${orgCounts.completed} done (${completionRate}%) · 🔄 ${orgCounts.in_progress} in progress · 📤 ${orgCounts.submitted} submitted · ⏰ ${orgCounts.overdue} overdue\n\n` +
        (orgCounts.overdue > 0 ? `**Overdue:** ${orgOverdueList}\n\n` : `✅ No overdue tasks.\n\n`) +
        (orgLb ? `**Team:** ${orgLb}\n\n` : '') +
        `**Projects:** ${orgProjects}`;

      return res.json({ text: fallbackText, offline: true });
    }

    // Build system prompt with live data    // Build system prompt with live data
    const tasks = orgContext.tasks || [];
    const counts = { total: tasks.length, overdue: 0, pending: 0, in_progress: 0, completed: 0, submitted: 0 };
    for (const t of tasks) {
      if (t.status === 'overdue') counts.overdue++;
      else if (t.status === 'pending') counts.pending++;
      else if (t.status === 'in_progress') counts.in_progress++;
      else if (t.status === 'completed' || t.status === 'manager_approved') counts.completed++;
      else if (t.status === 'submitted') counts.submitted++;
    }

    // Extract signals for citation and logging
    const signals = extractSignals(orgContext);

    // Use safe system prompt with citation requirements
    const systemPrompt = buildSafeSystemPrompt(orgContext, signals);

    // Log the AI session context (non-blocking)
    logAIRecommendation({
      orgId: req.user.org_id,
      userId: req.user.id,
      recommendationType: 'chat_session',
      recommendation: { messageCount: messages.length, lastUserMessage: messages[messages.length - 1]?.content?.slice(0, 200) },
      signals: signals.slice(0, 10),
      confidence: null,
    }).catch(() => {});

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
      const status = anthropicRes.status;
      const errMsg = err?.error?.message || '';

      // Credit exhausted (402) or overloaded (529) — try Groq free tier first
      if (status === 402 || status === 529 || errMsg.toLowerCase().includes('credit')) {
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey) {
          try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`,
              },
              body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                max_tokens: 1000,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...messages.map(m => ({ role: m.role, content: m.content })),
                ],
              }),
            });
            if (groqRes.ok) {
              const groqData = await groqRes.json();
              const text = groqData.choices?.[0]?.message?.content;
              if (text) return res.json({ text, model: 'groq-llama3' });
            }
          } catch (groqErr) {
            console.warn('[AI] Groq fallback failed:', groqErr);
          }
        }

        // No Groq key or Groq also failed — return live org summary
        const tasks = orgContext.tasks || [];
        const counts = { total: tasks.length, overdue: 0, pending: 0, in_progress: 0, completed: 0 };
        for (const t of tasks) {
          if (t.status === 'overdue') counts.overdue++;
          else if (t.status === 'pending') counts.pending++;
          else if (t.status === 'in_progress') counts.in_progress++;
          else if (t.status === 'completed' || t.status === 'manager_approved') counts.completed++;
        }
        const overdueList = tasks.filter(t => t.status === 'overdue').slice(0, 5)
          .map(t => `• "${t.title}" — ${t.assigned_to_name || 'unassigned'}`).join('\n');
        const lb = (orgContext.leaderboard || []).slice(0, 5).filter(u => Number(u.total) > 0)
          .map(u => `• ${u.name}: ${u.completed}/${u.total} done`).join('\n');

        const fallback =
          `⚠️ **AI temporarily unavailable** (API credits exhausted).\n\n` +
          `💡 **To enable free AI:** Add \`GROQ_API_KEY\` in Railway (free at groq.com) — uses Llama 3.3 70B.\n\n` +
          `**Live org snapshot:**\n\n` +
          `📋 ${counts.total} tasks · ✅ ${counts.completed} done · 🔄 ${counts.in_progress} in progress · ⏰ ${counts.overdue} overdue\n\n` +
          (counts.overdue > 0 ? `**Overdue:**\n${overdueList}\n\n` : `✅ No overdue tasks.\n\n`) +
          (lb ? `**Team:**\n${lb}` : '');

        return res.json({ text: fallback, offline: true });
      }

      return res.status(status).json({
        error: errMsg || `AI service error (${status}). Please try again shortly.`
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
