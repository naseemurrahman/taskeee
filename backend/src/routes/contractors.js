const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { orgIdForSessionUser } = require('../utils/orgContext');

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId != null && orgId !== '' ? String(orgId) : null;
}

router.get('/', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { page = 1, limit = 50, status, search } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * safeLimit;

    const params = [orgId];
    const conditions = ['c.org_id = $1'];
    let p = 2;

    if (status) { conditions.push(`c.status = $${p++}`); params.push(String(status)); }
    if (search) {
      conditions.push(`(c.full_name ILIKE $${p} OR COALESCE(c.email,'') ILIKE $${p} OR COALESCE(c.company_name,'') ILIKE $${p})`);
      params.push(`%${String(search)}%`);
      p++;
    }

    if (!isOrgWideRole(req.user.role)) {
      conditions.push(`(c.owner_user_id = $${p++} OR c.owner_user_id IS NULL)`);
      params.push(req.user.id);
    }

    const { rows } = await query(
      `SELECT c.*, u.full_name AS owner_name, COUNT(*) OVER() AS total_count
       FROM contractors c
       LEFT JOIN users u ON u.id = c.owner_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.updated_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, safeLimit, offset]
    );
    res.json({ contractors: rows, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const fullName = String(req.body?.fullName || req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim() || null;
    const phoneE164 = String(req.body?.phoneE164 || req.body?.phone_e164 || '').trim() || null;
    const companyName = String(req.body?.companyName || req.body?.company_name || '').trim() || null;
    const countryCode = String(req.body?.countryCode || req.body?.country_code || '').trim() || null;
    const hourlyRate = req.body?.hourlyRate != null ? Number(req.body.hourlyRate) : null;
    const currency = String(req.body?.currency || 'USD').trim() || 'USD';
    const ownerUserId = req.body?.ownerUserId || req.user.id;

    if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'fullName is required' });

    const { rows } = await query(
      `INSERT INTO contractors (org_id, owner_user_id, full_name, email, phone_e164, company_name, country_code, hourly_rate, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [orgId, ownerUserId, fullName, email, phoneE164, companyName, countryCode, hourlyRate, currency]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'contractor.create',
      entityType: 'contractor',
      entityId: rows[0].id,
      metadata: { fullName, email, companyName },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.status(201).json({ contractor: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const id = req.params.id;
    const { rows } = await query(
      `SELECT c.*, u.full_name AS owner_name
       FROM contractors c
       LEFT JOIN users u ON u.id = c.owner_user_id
       WHERE c.id = $1 AND c.org_id = $2`,
      [id, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });
    const contractor = rows[0];

    if (!isOrgWideRole(req.user.role)) {
      if (contractor.owner_user_id && contractor.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    }

    const { rows: docs } = await query(
      `SELECT d.id, d.doc_type, d.created_at, a.original_filename, a.mime_type, a.size_bytes
       FROM contractor_documents d
       JOIN attachments a ON a.id = d.attachment_id
       WHERE d.contractor_id = $1 AND d.org_id = $2
       ORDER BY d.created_at DESC
       LIMIT 50`,
      [id, orgId]
    );

    res.json({ contractor, documents: docs });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const id = req.params.id;

    const allowed = ['status', 'full_name', 'email', 'phone_e164', 'company_name', 'country_code', 'hourly_rate', 'currency', 'start_date', 'end_date', 'owner_user_id'];
    const b = req.body || {};
    const map = {
      status: b.status,
      full_name: b.fullName ?? b.full_name,
      email: b.email,
      phone_e164: b.phoneE164 ?? b.phone_e164,
      company_name: b.companyName ?? b.company_name,
      country_code: b.countryCode ?? b.country_code,
      hourly_rate: b.hourlyRate ?? b.hourly_rate,
      currency: b.currency,
      start_date: b.startDate ?? b.start_date,
      end_date: b.endDate ?? b.end_date,
      owner_user_id: b.ownerUserId ?? b.owner_user_id,
    };

    const updates = [];
    const params = [];
    let p = 1;
    for (const k of allowed) {
      if (map[k] !== undefined) {
        let v = map[k];
        if (typeof v === 'string') v = v.trim();
        updates.push(`${k} = $${p++}`);
        params.push(v === '' ? null : v);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(id, orgId);
    const { rows } = await query(
      `UPDATE contractors SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${p++} AND org_id = $${p}
       RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Contractor not found' });

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'contractor.update',
      entityType: 'contractor',
      entityId: id,
      metadata: { fields: updates.map(x => x.split('=')[0].trim()) },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.json({ contractor: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;

