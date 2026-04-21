// routes/reports.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateReport, sendReportEmail } = require('../services/reportService');

// GET /reports
router.get('/', authenticate, async (req, res, next) => {
  try {
    const pageRaw = Number.parseInt(String(req.query.page || '1'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit || '20'), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
    const offset = (page - 1) * limit;
    const { rows } = await query(`
      SELECT *, COUNT(*) OVER() AS total
      FROM reports WHERE generated_for = $1
      ORDER BY created_at DESC LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);
    res.json({ reports: rows, total: parseInt(rows[0]?.total || 0) });
  } catch (err) { next(err); }
});

// GET /reports/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT * FROM reports WHERE id = $1 AND generated_for = $2
    `, [req.params.id, req.user.id]); // OWASP A01: own reports only
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id/export', authenticate, async (req, res, next) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const { rows } = await query(`
      SELECT * FROM reports WHERE id = $1 AND generated_for = $2
    `, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });

    const report = rows[0];
    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="report-${report.id}.json"`);
      return res.json({ report });
    }

    if (format === 'csv') {
      const payload = typeof report.data === 'string' ? JSON.parse(report.data || '{}') : (report.data || {});
      const flattened = Object.entries(payload).map(([key, value]) => [
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
      ]);
      const csv = ['key,value', ...flattened.map(([k, v]) => `"${String(k).replace(/"/g, '""')}","${String(v).replace(/"/g, '""')}"`)].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${report.id}.csv"`);
      return res.send(csv);
    }

    return res.status(400).json({ error: 'Unsupported export format' });
  } catch (err) { next(err); }
});

// POST /reports/generate – on-demand
router.post('/generate', authenticate, async (req, res, next) => {
  try {
    const { reportType = 'on_demand' } = req.body;
    const allowed = ['on_demand', 'daily', 'weekly', 'monthly'];
    if (!allowed.includes(reportType)) return res.status(400).json({ error: 'Invalid report type' });

    const end = new Date();
    const start = new Date();
    if (reportType === 'weekly') start.setDate(end.getDate() - 7);
    else if (reportType === 'monthly') start.setMonth(end.getMonth() - 1);
    else start.setDate(end.getDate() - 1);

    const data = await generateReport(req.user.id, req.user.org_id, start, end, reportType);
    res.json({ report: data });
  } catch (err) { next(err); }
});

module.exports = router;
