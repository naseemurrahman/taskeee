/**
 * aiSafetyService.js
 *
 * Priority 2 — AI Safety:
 * - Every AI recommendation is logged with signals used
 * - AI cannot mutate data without explicit user approval + audit log
 * - Every recommendation cites exact task/employee/project that triggered it
 */

const { query } = require('../utils/db');
const { logger } = require('../utils/logger');

/**
 * Log an AI recommendation to the database.
 * Creates ai_recommendations table if it doesn't exist.
 */
async function logAIRecommendation({ orgId, userId, recommendationType, recommendation, signals, confidence }) {
  try {
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS ai_recommendations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        generated_for UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type          TEXT NOT NULL,
        recommendation JSONB NOT NULL,
        signals       JSONB NOT NULL DEFAULT '[]',
        confidence    NUMERIC(4,2),
        applied       BOOLEAN NOT NULL DEFAULT false,
        applied_at    TIMESTAMPTZ,
        applied_by    UUID REFERENCES users(id),
        dismissed     BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_ai_recs_org ON ai_recommendations(org_id, created_at DESC)`);

    const { rows } = await query(`
      INSERT INTO ai_recommendations (org_id, generated_for, type, recommendation, signals, confidence)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [orgId, userId, recommendationType, JSON.stringify(recommendation), JSON.stringify(signals || []), confidence ?? null]);

    return rows[0]?.id;
  } catch (err) {
    // Non-fatal — logging failure should never block the AI response
    logger.warn('[aiSafety] Failed to log recommendation:', err.message);
    return null;
  }
}

/**
 * Mark a recommendation as applied (after user explicitly approves).
 */
async function applyRecommendation(recommendationId, appliedByUserId) {
  try {
    await query(`
      UPDATE ai_recommendations
      SET applied = true, applied_at = NOW(), applied_by = $2
      WHERE id = $1
    `, [recommendationId, appliedByUserId]);
  } catch (err) {
    logger.warn('[aiSafety] Failed to mark recommendation applied:', err.message);
  }
}

/**
 * Extract signals from org context for citation in AI responses.
 * Returns a structured list of signal objects that the AI can reference.
 */
function extractSignals(orgContext) {
  const signals = [];
  const tasks = orgContext.tasks || [];
  const lb = orgContext.leaderboard || [];

  // Overdue task signals
  const overdue = tasks.filter(t => t.status === 'overdue');
  for (const t of overdue.slice(0, 10)) {
    signals.push({
      type: 'overdue_task',
      entityType: 'task',
      entityId: t.id,
      entityName: t.title,
      assignee: t.assigned_to_name || 'unassigned',
      dueDate: t.due_date,
      weight: 'high',
    });
  }

  // Workload imbalance signals
  const totals = lb.map(u => Number(u.total || 0));
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  for (const u of lb) {
    const total = Number(u.total || 0);
    if (total > avg * 1.5) {
      signals.push({ type: 'overloaded_user', entityType: 'user', entityId: u.id, entityName: u.name, taskCount: total, avgTaskCount: Math.round(avg), weight: 'medium' });
    }
    if (total < avg * 0.5 && avg > 2) {
      signals.push({ type: 'underutilized_user', entityType: 'user', entityId: u.id, entityName: u.name, taskCount: total, avgTaskCount: Math.round(avg), weight: 'low' });
    }
  }

  // Completion rate signals
  for (const u of lb) {
    const rate = Number(u.completion_rate || u.completed) / Math.max(Number(u.total || 1), 1);
    if (rate < 0.4 && Number(u.total || 0) > 3) {
      signals.push({ type: 'low_completion_rate', entityType: 'user', entityId: u.id, entityName: u.name, completionRate: Math.round(rate * 100), weight: 'high' });
    }
  }

  return signals;
}

/**
 * Build a safe system prompt that:
 * 1. Instructs AI to cite exact signals used
 * 2. Forbids AI from taking actions without explicit user approval
 * 3. Requires explanations for every recommendation
 */
function buildSafeSystemPrompt(orgContext, signals) {
  const tasks = orgContext.tasks || [];
  const counts = { total: tasks.length, overdue: 0, inProgress: 0, completed: 0, submitted: 0 };
  for (const t of tasks) {
    if (t.status === 'overdue') counts.overdue++;
    else if (t.status === 'in_progress') counts.inProgress++;
    else if (['completed', 'manager_approved'].includes(t.status)) counts.completed++;
    else if (t.status === 'submitted') counts.submitted++;
  }

  const overdueList = tasks.filter(t => t.status === 'overdue').slice(0, 8)
    .map(t => `  - Task ID ${String(t.id).slice(0,8)}: "${t.title}" → ${t.assigned_to_name || 'unassigned'} (due ${t.due_date || 'unknown'})`)
    .join('\n');

  const lb = (orgContext.leaderboard || []).slice(0, 8)
    .map(u => `  - ${u.name}: ${u.completed}/${u.total} completed, ${u.overdue} overdue`)
    .join('\n');

  const projects = (orgContext.projects || []).map(p => p.name).join(', ') || 'none';

  const signalSummary = signals.length
    ? signals.slice(0, 6).map(s => `  - [${s.type}] ${s.entityType} "${s.entityName}": ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => !['type','entityType','entityId','entityName'].includes(k))))}`).join('\n')
    : '  - No significant signals detected.';

  return `You are JecZone AI, the intelligent assistant for TaskFlow Pro.

SAFETY RULES (NEVER break these):
1. You CANNOT perform any action (assign task, change status, delete, etc.) without the user explicitly saying "Yes, apply this".
2. Every recommendation MUST cite the specific task ID, employee name, or project that triggered it.
3. Every recommendation MUST explain WHY (e.g., "Task X is 5 days overdue and still assigned to John who already has 8 open tasks").
4. If uncertain, say so. Do not fabricate data.
5. You are a scoped assistant — you can only see data for this organization.

LIVE ORG DATA:
Tasks: ${counts.total} total | ${counts.inProgress} in progress | ${counts.submitted} submitted | ${counts.completed} completed | ${counts.overdue} OVERDUE
${counts.overdue > 0 ? `Overdue tasks:\n${overdueList}` : 'No overdue tasks.'}

Team performance:
${lb || '  No team data.'}

Active projects: ${projects}

KEY SIGNALS THIS SESSION:
${signalSummary}

RESPONSE FORMAT:
- Be concise and actionable
- Use markdown formatting
- Lead with the most urgent signal
- For each recommendation, end with: 📎 *Triggered by: [signal type] on [entity name]*
- If suggesting an action, end with: ⚡ *To apply: reply "Apply: [action description]"*`;
}

module.exports = {
  logAIRecommendation,
  applyRecommendation,
  extractSignals,
  buildSafeSystemPrompt,
};
