const nodemailer = require('nodemailer');
const { query } = require('../utils/db');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

/**
 * Generate a report for a user scoped to their visibility level.
 * - Employee: only their own tasks
 * - Supervisor/Manager: their team
 * - Director: full org
 */
async function generateReport(userId, orgId, periodStart, periodEnd, reportType = 'daily') {
  const { rows: [user] } = await query(
    `SELECT id, full_name, email, role FROM users WHERE id = $1`, [userId]
  );

  let targetUserIds = [userId];

  if (['supervisor', 'manager', 'director', 'admin'].includes(user.role)) {
    const { rows } = await query(
      `SELECT user_id FROM get_subordinate_ids($1)`, [userId]
    );
    targetUserIds = [userId, ...rows.map(r => r.user_id)];
  }

  // Task stats
  const { rows: stats } = await query(`
    SELECT
      status,
      COUNT(*) AS count,
      AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at))/3600)::INT AS avg_hours
    FROM tasks
    WHERE assigned_to = ANY($1) AND org_id = $2
      AND created_at BETWEEN $3 AND $4
    GROUP BY status
  `, [targetUserIds, orgId, periodStart, periodEnd]);

  // Task completion rate
  const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
  const completed = stats.find(s => s.status === 'completed')?.count || 0;
  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

  // Overdue tasks
  const { rows: overdueTasks } = await query(`
    SELECT t.title, t.due_date, u.full_name AS assigned_to_name
    FROM tasks t JOIN users u ON u.id = t.assigned_to
    WHERE t.assigned_to = ANY($1) AND t.org_id = $2
      AND t.due_date < NOW() AND t.status NOT IN ('completed','cancelled')
    ORDER BY t.due_date ASC LIMIT 10
  `, [targetUserIds, orgId]);

  // AI rejection rate
  const { rows: [aiStats] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE ai_status = 'approved') AS approved,
      COUNT(*) FILTER (WHERE ai_status = 'rejected') AS rejected,
      COUNT(*) AS total
    FROM task_photos tp
    JOIN tasks t ON t.id = tp.task_id
    WHERE t.assigned_to = ANY($1) AND t.org_id = $2
      AND tp.created_at BETWEEN $3 AND $4
  `, [targetUserIds, orgId, periodStart, periodEnd]);

  // Top performers (for managers+)
  let topPerformers = [];
  if (targetUserIds.length > 1) {
    const { rows } = await query(`
      SELECT u.full_name, u.email,
        COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
        COUNT(*) AS total
      FROM tasks t JOIN users u ON u.id = t.assigned_to
      WHERE t.assigned_to = ANY($1) AND t.org_id = $2
        AND t.created_at BETWEEN $3 AND $4
      GROUP BY u.id, u.full_name, u.email
      ORDER BY completed DESC LIMIT 5
    `, [targetUserIds, orgId, periodStart, periodEnd]);
    topPerformers = rows;
  }

  const reportData = {
    user: { id: userId, fullName: user.full_name, role: user.role },
    period: { start: periodStart, end: periodEnd, type: reportType },
    summary: { total, completed, completionRate, overdueTasks: overdueTasks.length },
    statusBreakdown: stats,
    overdueTasks,
    aiStats,
    topPerformers,
    generatedAt: new Date().toISOString()
  };

  // Persist report
  await query(`
    INSERT INTO reports (org_id, generated_for, report_type, scope_type, period_start, period_end, data)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [orgId, userId, reportType,
      user.role === 'employee' ? 'personal' :
      user.role === 'director' ? 'org' : 'team',
      periodStart, periodEnd, JSON.stringify(reportData)]);

  return reportData;
}

/**
 * Send email report to a user.
 */
async function sendReportEmail(userId, orgId, reportData) {
  const { rows: [user] } = await query(
    `SELECT email, full_name FROM users WHERE id = $1`, [userId]
  );

  const html = buildEmailHtml(reportData);

  try {
    await transporter.sendMail({
      from: `"TaskFlow Pro" <${process.env.SMTP_FROM}>`,
      to: user.email,
      subject: `${reportData.period.type.charAt(0).toUpperCase() + reportData.period.type.slice(1)} Task Report - ${new Date().toLocaleDateString()}`,
      html
    });

    await query(`
      UPDATE reports SET email_sent = TRUE, email_sent_at = NOW()
      WHERE generated_for = $1 AND period_start = $2
    `, [userId, reportData.period.start]);

    logger.info(`Report email sent to ${user.email}`);
  } catch (err) {
    logger.error(`Failed to send report email to ${user.email}:`, err.message);
  }
}

/**
 * Generate and send hierarchical reports:
 * Each level gets a report scoped to their visibility.
 */
async function runHierarchicalReports(orgId, reportType) {
  const { rows: users } = await query(
    `SELECT id, role FROM users WHERE org_id = $1 AND is_active = TRUE ORDER BY role`,
    [orgId]
  );

  const now = new Date();
  const periodEnd = now;
  const periodStart = new Date(now);

  if (reportType === 'daily') periodStart.setDate(now.getDate() - 1);
  else if (reportType === 'weekly') periodStart.setDate(now.getDate() - 7);
  else if (reportType === 'monthly') periodStart.setMonth(now.getMonth() - 1);

  // Generate for all users concurrently
  await Promise.allSettled(
    users.map(async (u) => {
      const reportData = await generateReport(u.id, orgId, periodStart, periodEnd, reportType);
      await sendReportEmail(u.id, orgId, reportData);
    })
  );
}

function buildEmailHtml(report) {
  const { summary, statusBreakdown, overdueTasks, topPerformers, user, period } = report;

  const statusRows = statusBreakdown.map(s =>
    `<tr><td style="padding:6px 12px">${s.status.replace(/_/g,' ')}</td>
     <td style="padding:6px 12px;text-align:right;font-weight:600">${s.count}</td></tr>`
  ).join('');

  const overdueRows = overdueTasks.map(t =>
    `<tr><td style="padding:6px 12px;color:#e53e3e">${t.title}</td>
     <td style="padding:6px 12px">${t.assigned_to_name}</td>
     <td style="padding:6px 12px">${new Date(t.due_date).toLocaleDateString()}</td></tr>`
  ).join('');

  const performerRows = topPerformers.map(p =>
    `<tr><td style="padding:6px 12px">${p.full_name}</td>
     <td style="padding:6px 12px;text-align:center">${p.completed}/${p.total}</td></tr>`
  ).join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#6c47d9;padding:24px;border-radius:8px;color:white;margin-bottom:24px">
      <h1 style="margin:0;font-size:22px">TaskFlow Pro</h1>
      <p style="margin:8px 0 0;opacity:0.85">${period.type.charAt(0).toUpperCase()+period.type.slice(1)} Report for ${user.fullName}</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
      <div style="background:#f7f7f7;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#6c47d9">${summary.total}</div>
        <div style="font-size:12px;color:#666;margin-top:4px">Total Tasks</div>
      </div>
      <div style="background:#f7f7f7;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#38a169">${summary.completionRate}%</div>
        <div style="font-size:12px;color:#666;margin-top:4px">Completion Rate</div>
      </div>
      <div style="background:#f7f7f7;padding:16px;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#e53e3e">${summary.overdueTasks}</div>
        <div style="font-size:12px;color:#666;margin-top:4px">Overdue</div>
      </div>
    </div>

    <h3>Task Status Breakdown</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0">
        <th style="padding:8px 12px;text-align:left">Status</th>
        <th style="padding:8px 12px;text-align:right">Count</th>
      </tr></thead>
      <tbody>${statusRows}</tbody>
    </table>

    ${overdueTasks.length ? `
    <h3 style="color:#e53e3e">Overdue Tasks</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#fff5f5">
        <th style="padding:8px 12px;text-align:left">Task</th>
        <th style="padding:8px 12px;text-align:left">Assigned To</th>
        <th style="padding:8px 12px;text-align:left">Due</th>
      </tr></thead>
      <tbody>${overdueRows}</tbody>
    </table>` : ''}

    ${topPerformers.length ? `
    <h3>Top Performers</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0">
        <th style="padding:8px 12px;text-align:left">Name</th>
        <th style="padding:8px 12px;text-align:center">Completed/Total</th>
      </tr></thead>
      <tbody>${performerRows}</tbody>
    </table>` : ''}

    <p style="margin-top:32px;font-size:12px;color:#999;text-align:center">
      Generated at ${new Date().toLocaleString()} · TaskFlow Pro
    </p>
  </body>
  </html>`;
}

module.exports = { generateReport, sendReportEmail, runHierarchicalReports };
