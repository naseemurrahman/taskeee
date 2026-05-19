const nodemailer = require('nodemailer');
const { query } = require('../utils/db');
const logger = require('../utils/logger');
const { filterNonTerminatedUserIds, safeSubordinateUserIds } = require('../utils/employeeVisibility');
const { buildReportAnalyticsSnapshot } = require('./reportSnapshotService');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

/**
 * Generate a report for a user scoped to their visibility level.
 * - Employee: only their own tasks
 * - Supervisor/Manager: their visible team
 * - Director/Admin/HR: visible organization
 *
 * Terminated employees are excluded from generated charts, top performers,
 * overdue lists, and project/task totals. Any non-terminated employee status is
 * included.
 */
async function generateReport(userId, orgId, periodStart, periodEnd, reportType = 'daily') {
  const { rows: [user] } = await query(
    `SELECT id, full_name, email, role FROM users WHERE id = $1`, [userId]
  );

  if (!user) throw new Error('User not found');

  const reportUser = { ...user, org_id: orgId };
  const analyticsSnapshot = await buildReportAnalyticsSnapshot(reportUser, { periodStart, periodEnd, reportType });

  let candidateUserIds = [userId];

  if (['supervisor', 'manager'].includes(user.role)) {
    try {
      const subordinateIds = await safeSubordinateUserIds(userId);
      candidateUserIds = [userId, ...subordinateIds];
    } catch (_err) {
      logger.warn(`[reportService] get_subordinate_ids not available, using self-only scope for ${userId}`);
    }
  } else if (['director', 'admin', 'hr'].includes(user.role)) {
    candidateUserIds = null;
  }

  const targetUserIds = await filterNonTerminatedUserIds(orgId, candidateUserIds, { requireActive: true });

  if (!targetUserIds.length) {
    const emptyReportData = {
      user: { id: userId, fullName: user.full_name, role: user.role },
      period: { start: periodStart, end: periodEnd, type: reportType },
      summary: { total: 0, completed: 0, completionRate: 0, overdueTasks: 0 },
      statusBreakdown: [],
      overdueTasks: [],
      aiStats: { approved: 0, rejected: 0, total: 0 },
      topPerformers: [],
      projectBreakdown: [],
      analyticsSnapshot,
      generatedAt: new Date().toISOString()
    };

    await query(`
      INSERT INTO reports (org_id, generated_for, report_type, scope_type, period_start, period_end, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [orgId, userId, reportType,
        user.role === 'employee' ? 'personal' :
        user.role === 'director' ? 'org' : 'team',
        periodStart, periodEnd, JSON.stringify(emptyReportData)]);

    return emptyReportData;
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
  const completed = stats.find(s => ['completed', 'manager_approved'].includes(s.status))?.count || 0;
  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

  // Overdue tasks
  const { rows: overdueTasks } = await query(`
    SELECT t.title, t.due_date, u.full_name AS assigned_to_name,
           p.name AS project_name
    FROM tasks t
    JOIN users u ON u.id = t.assigned_to
    LEFT JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
    WHERE t.assigned_to = ANY($1) AND t.org_id = $2
      AND t.due_date < NOW() AND t.status NOT IN ('completed','manager_approved','cancelled')
    ORDER BY t.due_date ASC LIMIT 10
  `, [targetUserIds, orgId]).catch(async (err) => {
    if (err.code !== '42P01' && err.code !== '42703') throw err;
    return query(`
      SELECT t.title, t.due_date, u.full_name AS assigned_to_name,
             NULL::text AS project_name
      FROM tasks t JOIN users u ON u.id = t.assigned_to
      WHERE t.assigned_to = ANY($1) AND t.org_id = $2
        AND t.due_date < NOW() AND t.status NOT IN ('completed','manager_approved','cancelled')
      ORDER BY t.due_date ASC LIMIT 10
    `, [targetUserIds, orgId]);
  });

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
  `, [targetUserIds, orgId]);

  // Top performers (for managers+)
  let topPerformers = [];
  if (targetUserIds.length > 1) {
    const { rows } = await query(`
      SELECT u.full_name, u.email,
        COUNT(*) FILTER (WHERE t.status IN ('completed','manager_approved')) AS completed,
        COUNT(*) AS total
      FROM tasks t JOIN users u ON u.id = t.assigned_to
      WHERE t.assigned_to = ANY($1) AND t.org_id = $2
        AND t.created_at BETWEEN $3 AND $4
      GROUP BY u.id, u.full_name, u.email
      ORDER BY completed DESC LIMIT 5
    `, [targetUserIds, orgId, periodStart, periodEnd]);
    topPerformers = rows;
  }

  let projectBreakdown = [];
  try {
    const { rows } = await query(`
      SELECT p.id AS project_id,
             p.name AS project_name,
             COALESCE(p.status, 'active') AS project_status,
             COUNT(t.id)::int AS total_tasks,
             COUNT(t.id) FILTER (WHERE t.status IN ('completed','manager_approved'))::int AS completed_tasks,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('completed','manager_approved','cancelled'))::int AS open_tasks
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
                         AND t.org_id = p.org_id
                         AND t.assigned_to = ANY($1)
                         AND t.created_at BETWEEN $3 AND $4
       WHERE p.org_id = $2
       GROUP BY p.id, p.name, p.status
       ORDER BY open_tasks DESC, total_tasks DESC, p.name ASC
       LIMIT 20
    `, [targetUserIds, orgId, periodStart, periodEnd]);
    projectBreakdown = rows;
  } catch (err) {
    if (err.code !== '42P01' && err.code !== '42703') throw err;
    projectBreakdown = [];
  }

  const reportData = {
    user: { id: userId, fullName: user.full_name, role: user.role },
    period: { start: periodStart, end: periodEnd, type: reportType },
    summary: { total, completed, completionRate, overdueTasks: overdueTasks.length },
    statusBreakdown: stats,
    overdueTasks,
    aiStats,
    topPerformers,
    projectBreakdown,
    analyticsSnapshot,
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
      from: `"TASKEE" <${process.env.SMTP_FROM}>`,
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
  const targetUserIds = await filterNonTerminatedUserIds(orgId, null, { requireActive: true });
  const { rows: users } = targetUserIds.length ? await query(
    `SELECT id, role FROM users WHERE org_id = $1 AND id = ANY($2) ORDER BY role`,
    [orgId, targetUserIds]
  ) : { rows: [] };

  const now = new Date();
  const periodEnd = now;
  const periodStart = new Date(now);

  if (reportType === 'daily') periodStart.setDate(now.getDate() - 1);
  else if (reportType === 'weekly') periodStart.setDate(now.getDate() - 7);
  else if (reportType === 'monthly') periodStart.setMonth(now.getMonth() - 1);

  // Generate for all visible non-terminated users concurrently
  await Promise.allSettled(
    users.map(async (u) => {
      const reportData = await generateReport(u.id, orgId, periodStart, periodEnd, reportType);
      await sendReportEmail(u.id, orgId, reportData);
    })
  );
}

function buildEmailHtml(report) {
  const { summary, statusBreakdown, overdueTasks, topPerformers, projectBreakdown = [], analyticsSnapshot, user, period } = report;
  const snapshot = analyticsSnapshot || {};
  const snapSummary = snapshot.summary || {};
  const snapProjects = snapshot.project_summary?.projects || [];
  const snapDepartments = snapshot.department_performance?.departments || [];
  const snapEmployees = snapshot.employee_performance?.employees || [];
  const snapSla = snapshot.sla_risk || { summary: {}, tasks: [] };

  const statusRows = statusBreakdown.map(s =>
    `<tr><td style="padding:6px 12px">${s.status.replace(/_/g,' ')}</td>
     <td style="padding:6px 12px;text-align:right;font-weight:600">${s.count}</td></tr>`
  ).join('');

  const overdueRows = overdueTasks.map(t =>
    `<tr><td style="padding:6px 12px;color:#e53e3e">${t.title}</td>
     <td style="padding:6px 12px">${t.project_name || '—'}</td>
     <td style="padding:6px 12px">${t.assigned_to_name}</td>
     <td style="padding:6px 12px">${new Date(t.due_date).toLocaleDateString()}</td></tr>`
  ).join('');

  const performerRows = topPerformers.map(p =>
    `<tr><td style="padding:6px 12px">${p.full_name}</td>
     <td style="padding:6px 12px;text-align:center">${p.completed}/${p.total}</td></tr>`
  ).join('');

  const projectRows = projectBreakdown.map(p =>
    `<tr><td style="padding:6px 12px">${p.project_name}</td>
     <td style="padding:6px 12px;text-align:center">${p.project_status}</td>
     <td style="padding:6px 12px;text-align:center">${p.open_tasks}</td>
     <td style="padding:6px 12px;text-align:center">${p.completed_tasks}/${p.total_tasks}</td></tr>`
  ).join('');

  const analyticsProjectRows = snapProjects.slice(0, 8).map(p =>
    `<tr><td style="padding:6px 12px">${p.project_name}</td>
     <td style="padding:6px 12px;text-align:center">${p.open_tasks}</td>
     <td style="padding:6px 12px;text-align:center">${p.overdue_tasks}</td>
     <td style="padding:6px 12px;text-align:center">${p.completion_rate || 0}%</td></tr>`
  ).join('');

  const analyticsDepartmentRows = snapDepartments.slice(0, 8).map(d =>
    `<tr><td style="padding:6px 12px">${d.department || 'Unassigned'}</td>
     <td style="padding:6px 12px;text-align:center">${d.employee_count}</td>
     <td style="padding:6px 12px;text-align:center">${d.open_tasks}</td>
     <td style="padding:6px 12px;text-align:center">${d.completion_rate || 0}%</td></tr>`
  ).join('');

  const analyticsEmployeeRows = snapEmployees.slice(0, 8).map(e =>
    `<tr><td style="padding:6px 12px">${e.employee_name || 'Unassigned'}</td>
     <td style="padding:6px 12px;text-align:center">${e.assigned}</td>
     <td style="padding:6px 12px;text-align:center">${e.completed}</td>
     <td style="padding:6px 12px;text-align:center">${e.overdue}</td></tr>`
  ).join('');

  const slaRows = (snapSla.tasks || []).slice(0, 8).map(t =>
    `<tr><td style="padding:6px 12px;color:#e53e3e">${t.title}</td>
     <td style="padding:6px 12px;text-align:center">${t.risk_score}</td>
     <td style="padding:6px 12px">${t.risk_reason || ''}</td></tr>`
  ).join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#6c47d9;padding:24px;border-radius:8px;color:white;margin-bottom:24px">
      <h1 style="margin:0;font-size:22px">TASKEE</h1>
      <p style="margin:8px 0 0;opacity:0.85">${period.type.charAt(0).toUpperCase()+period.type.slice(1)} Report for ${user.fullName}</p>
      <p style="margin:8px 0 0;opacity:0.85;font-size:12px">Terminated employees excluded from all analytics snapshots.</p>
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

    <h3>Live Analytics Snapshot</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tbody>
        <tr><td style="padding:6px 12px">Tasks in scope</td><td style="padding:6px 12px;text-align:right;font-weight:600">${snapSummary.total_tasks || 0}</td></tr>
        <tr><td style="padding:6px 12px">Completed tasks</td><td style="padding:6px 12px;text-align:right;font-weight:600">${snapSummary.completed_tasks || 0}</td></tr>
        <tr><td style="padding:6px 12px">Active employees</td><td style="padding:6px 12px;text-align:right;font-weight:600">${snapSummary.active_employees || 0}</td></tr>
        <tr><td style="padding:6px 12px">SLA risk signals</td><td style="padding:6px 12px;text-align:right;font-weight:600">${(snapSla.tasks || []).length}</td></tr>
      </tbody>
    </table>

    <h3>Task Status Breakdown</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0">
        <th style="padding:8px 12px;text-align:left">Status</th>
        <th style="padding:8px 12px;text-align:right">Count</th>
      </tr></thead>
      <tbody>${statusRows}</tbody>
    </table>

    ${projectBreakdown.length ? `
    <h3>Project Breakdown</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0">
        <th style="padding:8px 12px;text-align:left">Project</th>
        <th style="padding:8px 12px;text-align:center">Status</th>
        <th style="padding:8px 12px;text-align:center">Open</th>
        <th style="padding:8px 12px;text-align:center">Completed/Total</th>
      </tr></thead>
      <tbody>${projectRows}</tbody>
    </table>` : ''}

    ${analyticsProjectRows ? `
    <h3>Advanced Project Snapshot</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0"><th style="padding:8px 12px;text-align:left">Project</th><th>Open</th><th>Overdue</th><th>Completion</th></tr></thead>
      <tbody>${analyticsProjectRows}</tbody>
    </table>` : ''}

    ${analyticsDepartmentRows ? `
    <h3>Department Snapshot</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0"><th style="padding:8px 12px;text-align:left">Department</th><th>People</th><th>Open</th><th>Completion</th></tr></thead>
      <tbody>${analyticsDepartmentRows}</tbody>
    </table>` : ''}

    ${analyticsEmployeeRows ? `
    <h3>Employee Performance Snapshot</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f0f0f0"><th style="padding:8px 12px;text-align:left">Employee</th><th>Assigned</th><th>Completed</th><th>Overdue</th></tr></thead>
      <tbody>${analyticsEmployeeRows}</tbody>
    </table>` : ''}

    ${slaRows ? `
    <h3 style="color:#e53e3e">SLA Risk Queue</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#fff5f5"><th style="padding:8px 12px;text-align:left">Task</th><th>Score</th><th>Reason</th></tr></thead>
      <tbody>${slaRows}</tbody>
    </table>` : ''}

    ${overdueTasks.length ? `
    <h3 style="color:#e53e3e">Overdue Tasks</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#fff5f5">
        <th style="padding:8px 12px;text-align:left">Task</th>
        <th style="padding:8px 12px;text-align:left">Project</th>
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
      Generated at ${new Date().toLocaleString()} · TASKEE
    </p>
  </body>
  </html>`;
}

module.exports = { generateReport, sendReportEmail, runHierarchicalReports };