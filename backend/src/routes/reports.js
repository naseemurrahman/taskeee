// routes/reports.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { ensureReportsTable } = require('../utils/ensureReportsTable');
const { authenticate, isOrgWideRole } = require('../middleware/auth');
const { generateReport } = require('../services/reportService');
const PDFDocument = require('pdfkit');

function isMissingReportsTableError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return code === '42P01' && (msg.includes('reports') || msg.includes('relation'));
}

async function ensureReportsBeforeRetry(err) {
  if (!isMissingReportsTableError(err)) return false;
  await ensureReportsTable();
  return true;
}

function parseReportData(data) {
  if (!data) return {};
  if (typeof data !== 'string') return data;
  try { return JSON.parse(data || '{}'); } catch (_err) { return {}; }
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

function addPdfPageIfNeeded(doc, needed = 74) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function addPdfSection(doc, title) {
  addPdfPageIfNeeded(doc, 58);
  doc.moveDown(0.7);
  doc.fillColor('#111').fontSize(13).font('Helvetica-Bold').text(title);
  doc.moveDown(0.25);
}

function addPdfKeyValues(doc, rows) {
  rows.forEach(([label, value]) => {
    addPdfPageIfNeeded(doc, 24);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#555').text(`${label}: `, { continued: true });
    doc.font('Helvetica').fillColor('#111').text(safeText(value));
  });
}

function addPdfRows(doc, rows, mapper, emptyText) {
  if (!rows || !rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(emptyText || 'No rows available.');
    return;
  }
  rows.forEach((row, index) => {
    addPdfPageIfNeeded(doc, 38);
    const lines = mapper(row, index).filter(Boolean);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(lines[0]);
    lines.slice(1).forEach((line) => doc.font('Helvetica').fontSize(8).fillColor('#555').text(line));
    doc.moveDown(0.2);
  });
}

function renderReportPdf(doc, report, payload) {
  const snapshot = payload.analyticsSnapshot || {};
  const summary = payload.summary || {};
  const snapSummary = snapshot.summary || {};
  const projectSummary = snapshot.project_summary?.projects || [];
  const departments = snapshot.department_performance?.departments || [];
  const employees = snapshot.employee_performance?.employees || [];
  const slaRisk = snapshot.sla_risk || { summary: {}, tasks: [] };

  doc.font('Helvetica-Bold').fontSize(21).fillColor('#111').text('TASKEE Report');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#555');
  doc.text(`Report ID: ${report.id}`);
  doc.text(`Type: ${report.report_type}`);
  doc.text(`Scope: ${safeText(report.scope_type)}`);
  doc.text(`Generated: ${new Date(report.created_at).toLocaleString()}`);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#7c2d12').text('Terminated employees are excluded from report charts, performance, workload, SLA risk, project, and department analytics.');

  addPdfSection(doc, 'Snapshot Summary');
  addPdfKeyValues(doc, [
    ['Legacy total tasks', summary.total ?? 0],
    ['Legacy completion rate', `${summary.completionRate ?? 0}%`],
    ['Legacy overdue tasks', summary.overdueTasks ?? 0],
    ['Analytics tasks in scope', snapSummary.total_tasks ?? 0],
    ['Analytics completed tasks', snapSummary.completed_tasks ?? 0],
    ['Analytics pending tasks', snapSummary.pending_tasks ?? 0],
    ['Analytics overdue tasks', snapSummary.overdue_tasks ?? 0],
    ['Active employees', snapSummary.active_employees ?? 0],
    ['SLA open tasks', slaRisk.summary?.open_tasks ?? 0],
    ['SLA due within 72h', slaRisk.summary?.due_soon_72h ?? 0],
    ['SLA critical open', slaRisk.summary?.critical_priority_open ?? 0],
  ]);

  addPdfSection(doc, 'Task Status Breakdown');
  addPdfRows(doc, payload.statusBreakdown || [], (row) => [
    `${safeText(row.status).replace(/_/g, ' ')} — ${safeText(row.count, 0)}`,
    `Average hours: ${safeText(row.avg_hours, 0)}`,
  ], 'No task status data in this snapshot.');

  addPdfSection(doc, 'Project Snapshot');
  addPdfRows(doc, projectSummary.slice(0, 12), (row) => [
    `${safeText(row.project_name)} — ${safeText(row.completion_rate, 0)}% complete`,
    `Total ${safeText(row.total_tasks, 0)} · Open ${safeText(row.open_tasks, 0)} · Overdue ${safeText(row.overdue_tasks, 0)} · High priority ${safeText(row.high_priority_tasks, 0)}`,
  ], 'No project analytics in this snapshot.');

  addPdfSection(doc, 'Department Performance');
  addPdfRows(doc, departments.slice(0, 12), (row) => [
    `${safeText(row.department, 'Unassigned')} — ${safeText(row.completion_rate, 0)}% complete`,
    `People ${safeText(row.employee_count, 0)} · Assigned ${safeText(row.assigned_tasks, 0)} · Open ${safeText(row.open_tasks, 0)} · Overdue ${safeText(row.overdue_tasks, 0)}`,
  ], 'No department analytics in this snapshot.');

  addPdfSection(doc, 'Employee Performance');
  addPdfRows(doc, employees.slice(0, 12), (row) => [
    `${safeText(row.employee_name, 'Unassigned')}`,
    `Assigned ${safeText(row.assigned, 0)} · Completed ${safeText(row.completed, 0)} · Overdue ${safeText(row.overdue, 0)}`,
  ], 'No employee performance analytics in this snapshot.');

  addPdfSection(doc, 'SLA Risk Queue');
  addPdfRows(doc, (slaRisk.tasks || []).slice(0, 12), (row) => [
    `${safeText(row.title)} — score ${safeText(row.risk_score, 0)}`,
    `${safeText(row.risk_reason)} · Owner ${safeText(row.assigned_to_name, 'Unassigned')} · Due ${safeText(row.due_date)}`,
  ], 'No SLA risk tasks in this snapshot.');

  addPdfSection(doc, 'Overdue Tasks');
  addPdfRows(doc, (payload.overdueTasks || []).slice(0, 12), (row) => [
    `${safeText(row.title)} — due ${safeText(row.due_date)}`,
    `Project ${safeText(row.project_name)} · Owner ${safeText(row.assigned_to_name, 'Unassigned')}`,
  ], 'No overdue tasks in this report.');

  if (snapshot.errors?.length) {
    addPdfSection(doc, 'Snapshot Warnings');
    addPdfRows(doc, snapshot.errors, (row, index) => [`${index + 1}. ${safeText(row)}`], 'No snapshot warnings.');
  }
}

// GET /reports
router.get('/', authenticate, async (req, res, next) => {
  async function runListQuery() {
    const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit || '20'), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
    const offset = (page - 1) * limit;
    const candidateSelects = [
      'id, report_type, scope_type, period_start, period_end, email_sent, created_at',
      'id, report_type, scope AS scope_type, period_start, period_end, email_sent, created_at',
      'id, report_type, NULL::text AS scope_type, period_start, period_end, email_sent, created_at',
      'id, report_type, NULL::text AS scope_type, NULL::timestamptz AS period_start, NULL::timestamptz AS period_end, email_sent, created_at'
    ];

    let rows = null;
    let lastColumnErr = null;
    for (const selectClause of candidateSelects) {
      try {
        const result = await query(`
          SELECT ${selectClause}, COUNT(*) OVER() AS total
          FROM reports WHERE generated_for = $1
          ORDER BY created_at DESC LIMIT $2 OFFSET $3
        `, [req.user.id, limit, offset]);
        rows = result.rows;
        break;
      } catch (err) {
        if (err?.code === '42703') {
          lastColumnErr = err;
          continue;
        }
        throw err;
      }
    }

    if (!rows) throw lastColumnErr;
    return rows;
  }

  try {
    try {
      const rows = await runListQuery();
      return res.json({ reports: rows, total: parseInt(rows[0]?.total || 0) });
    } catch (err) {
      if (await ensureReportsBeforeRetry(err)) {
        const rows = await runListQuery();
        return res.json({ reports: rows, total: parseInt(rows[0]?.total || 0), autoMigrated: true });
      }
      throw err;
    }
  } catch (err) {
    if (isMissingReportsTableError(err)) {
      return res.json({
        reports: [],
        total: 0,
        migrationRequired: true,
        warning: 'Reports table missing. Run database migrations.',
      });
    }
    next(err);
  }
});

// GET /reports/:id
router.get('/:id', authenticate, async (req, res, next) => {
  async function runGetQuery() {
    const isPrivileged = isOrgWideRole(req.user.role);
    return await query(
      isPrivileged
        ? `SELECT * FROM reports WHERE id = $1 AND org_id = $2`
        : `SELECT * FROM reports WHERE id = $1 AND generated_for = $2`,
      isPrivileged ? [req.params.id, req.user.org_id] : [req.params.id, req.user.id]
    );
  }

  try {
    try {
      const { rows } = await runGetQuery();
      if (!rows.length) return res.status(404).json({ error: 'Report not found' });
      return res.json({ report: rows[0] });
    } catch (err) {
      if (await ensureReportsBeforeRetry(err)) {
        const { rows } = await runGetQuery();
        if (!rows.length) return res.status(404).json({ error: 'Report not found' });
        return res.json({ report: rows[0], autoMigrated: true });
      }
      throw err;
    }
  } catch (err) {
    if (isMissingReportsTableError(err)) {
      return res.status(503).json({ error: 'Reports are not available yet. Run database migrations.', migrationRequired: true });
    }
    next(err);
  }
});

router.get('/:id/export', authenticate, async (req, res, next) => {
  async function runExportQuery() {
    const isPrivileged = isOrgWideRole(req.user.role);
    return await query(
      isPrivileged
        ? `SELECT * FROM reports WHERE id = $1 AND org_id = $2`
        : `SELECT * FROM reports WHERE id = $1 AND generated_for = $2`,
      isPrivileged ? [req.params.id, req.user.org_id] : [req.params.id, req.user.id]
    );
  }

  try {
    const format = String(req.query.format || 'json').toLowerCase();
    let rows;
    try {
      ({ rows } = await runExportQuery());
    } catch (err) {
      if (await ensureReportsBeforeRetry(err)) ({ rows } = await runExportQuery());
      else throw err;
    }
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });

    const report = rows[0];
    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="report-${report.id}.json"`);
      return res.json({ report });
    }

    if (format === 'csv') {
      const payload = parseReportData(report.data);
      const flattened = Object.entries(payload).map(([key, value]) => [
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
      ]);
      const csv = ['key,value', ...flattened.map(([k, v]) => `"${String(k).replace(/"/g, '""')}","${String(v).replace(/"/g, '""')}"`)].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${report.id}.csv"`);
      return res.send(csv);
    }

    if (format === 'pdf') {
      const payload = parseReportData(report.data);
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', () => null);
      renderReportPdf(doc, report, payload);
      doc.end();
      const pdfBuffer = await new Promise((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report-${report.id}.pdf"`);
      return res.send(pdfBuffer);
    }

    return res.status(400).json({ error: 'Unsupported export format' });
  } catch (err) {
    if (isMissingReportsTableError(err)) {
      return res.status(503).json({ error: 'Reports are not available yet. Run database migrations.', migrationRequired: true });
    }
    next(err);
  }
});

// POST /reports/generate – on-demand
router.post('/generate', authenticate, async (req, res, next) => {
  try {
    const { reportType = 'on_demand' } = req.body;
    const typeMap = {
      task_completion: 'on_demand',
      employee_performance: 'weekly',
      project_summary: 'monthly',
      on_demand: 'on_demand',
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
    };
    const resolvedType = typeMap[reportType] || reportType;
    const allowed = ['on_demand', 'daily', 'weekly', 'monthly'];
    if (!allowed.includes(resolvedType)) return res.status(400).json({ error: 'Invalid report type' });

    await ensureReportsTable();

    const end = new Date();
    const start = new Date();
    if (resolvedType === 'weekly') start.setDate(end.getDate() - 7);
    else if (resolvedType === 'monthly') start.setMonth(end.getMonth() - 1);
    else start.setDate(end.getDate() - 1);

    const data = await generateReport(req.user.id, req.user.org_id, start, end, resolvedType);
    res.json({ report: data });
  } catch (err) {
    if (isMissingReportsTableError(err)) {
      return res.status(503).json({ error: 'Reports are not available yet. Run database migrations.', migrationRequired: true });
    }
    next(err);
  }
});

module.exports = router;