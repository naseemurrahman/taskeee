'use strict';
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../utils/db');

// POST /api/v1/ai/chat — proxy to Anthropic, keeps API key server-side
router.post('/chat', authenticate, async (req, res, next) => {
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
