'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');

const MANAGEMENT_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];
const WRITE_ROLES = ['manager', 'hr', 'director', 'admin'];
const VISIBILITIES = new Set(['org', 'management', 'hr', 'admin']);

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function allowedVisibilityForRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return ['org', 'management', 'hr', 'admin'];
  if (r === 'director' || r === 'hr') return ['org', 'management', 'hr'];
  if (r === 'manager' || r === 'supervisor') return ['org', 'management'];
  return ['org'];
}

async function ensureKnowledgeSchema() {
  await query(`CREATE TABLE IF NOT EXISTS knowledge_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    category TEXT,
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    visibility TEXT NOT NULL DEFAULT 'org',
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (visibility IN ('org', 'management', 'hr', 'admin'))
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_knowledge_articles_org_updated ON knowledge_articles(org_id, updated_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(org_id, category)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tags ON knowledge_articles USING GIN(tags)`);
}

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function visibleWhere(req, params, alias = 'ka') {
  const vis = allowedVisibilityForRole(req.user.role);
  params.push(vis);
  return `${alias}.visibility = ANY($${params.length}::text[])`;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    await ensureKnowledgeSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const offset = (page - 1) * limit;

    const params = [orgId];
    const where = ['ka.org_id = $1', 'ka.is_published = TRUE', visibleWhere(req, params, 'ka')];
    let p = params.length + 1;
    if (q) {
      where.push(`(ka.title ILIKE $${p} OR COALESCE(ka.summary, '') ILIKE $${p} OR COALESCE(ka.content, '') ILIKE $${p} OR array_to_string(ka.tags, ' ') ILIKE $${p})`);
      params.push(`%${q}%`);
      p++;
    }
    if (category) {
      where.push(`ka.category = $${p++}`);
      params.push(category);
    }
    params.push(limit, offset);

    const { rows } = await query(
      `SELECT ka.id, ka.title, ka.summary, ka.category, ka.tags, ka.visibility,
              ka.created_at, ka.updated_at,
              u.full_name AS updated_by_name,
              COUNT(*) OVER() AS total_count
         FROM knowledge_articles ka
         LEFT JOIN users u ON u.id = COALESCE(ka.updated_by, ka.created_by)
        WHERE ${where.join(' AND ')}
        ORDER BY ka.updated_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      params
    );
    res.json({ articles: rows, page, limit, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    await ensureKnowledgeSchema();
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid article id' });
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const params = [orgId, req.params.id];
    const { rows } = await query(
      `SELECT ka.*, u.full_name AS created_by_name, uu.full_name AS updated_by_name
         FROM knowledge_articles ka
         LEFT JOIN users u ON u.id = ka.created_by
         LEFT JOIN users uu ON uu.id = ka.updated_by
        WHERE ka.org_id = $1 AND ka.id = $2 AND ka.is_published = TRUE AND ${visibleWhere(req, params, 'ka')}
        LIMIT 1`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json({ article: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    await ensureKnowledgeSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    if (title.length < 2) return res.status(400).json({ error: 'Title is required' });
    if (content.length < 2) return res.status(400).json({ error: 'Content is required' });
    const visibility = String(req.body?.visibility || 'org').trim().toLowerCase();
    if (!VISIBILITIES.has(visibility)) return res.status(400).json({ error: 'Invalid visibility' });
    if (!allowedVisibilityForRole(req.user.role).includes(visibility)) return res.status(403).json({ error: 'You cannot create articles with this visibility' });
    const tags = normalizeTags(req.body?.tags);

    const { rows } = await query(
      `INSERT INTO knowledge_articles (org_id, title, summary, content, category, tags, visibility, is_published, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING *`,
      [orgId, title, String(req.body?.summary || '').trim() || null, content, String(req.body?.category || '').trim() || null, tags, visibility, req.body?.is_published !== false, req.user.id]
    );

    await logAudit({ orgId, actorUserId: req.user.id, action: 'knowledge_article.create', entityType: 'knowledge_article', entityId: rows[0].id, metadata: { title, visibility }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ article: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireAnyRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    await ensureKnowledgeSchema();
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid article id' });
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const sets = [];
    const values = [];
    function set(col, val) { values.push(val); sets.push(`${col} = $${values.length}`); }
    if (typeof req.body?.title === 'string') {
      const title = req.body.title.trim();
      if (title.length < 2) return res.status(400).json({ error: 'Title is required' });
      set('title', title);
    }
    if (typeof req.body?.summary === 'string') set('summary', req.body.summary.trim() || null);
    if (typeof req.body?.content === 'string') {
      const content = req.body.content.trim();
      if (content.length < 2) return res.status(400).json({ error: 'Content is required' });
      set('content', content);
    }
    if (typeof req.body?.category === 'string') set('category', req.body.category.trim() || null);
    if (Array.isArray(req.body?.tags)) set('tags', normalizeTags(req.body.tags));
    if (typeof req.body?.visibility === 'string') {
      const visibility = req.body.visibility.trim().toLowerCase();
      if (!VISIBILITIES.has(visibility)) return res.status(400).json({ error: 'Invalid visibility' });
      if (!allowedVisibilityForRole(req.user.role).includes(visibility)) return res.status(403).json({ error: 'You cannot set this visibility' });
      set('visibility', visibility);
    }
    if (typeof req.body?.is_published === 'boolean') set('is_published', req.body.is_published);
    set('updated_by', req.user.id);
    set('updated_at', new Date().toISOString());
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided' });
    values.push(orgId, req.params.id);

    const { rows } = await query(
      `UPDATE knowledge_articles SET ${sets.join(', ')} WHERE org_id = $${values.length - 1} AND id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });

    await logAudit({ orgId, actorUserId: req.user.id, action: 'knowledge_article.update', entityType: 'knowledge_article', entityId: rows[0].id, metadata: { title: rows[0].title, visibility: rows[0].visibility }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ article: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAnyRole(...WRITE_ROLES), async (req, res, next) => {
  try {
    await ensureKnowledgeSchema();
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid article id' });
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `UPDATE knowledge_articles SET is_published = FALSE, updated_by = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2 RETURNING id, title`,
      [orgId, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    await logAudit({ orgId, actorUserId: req.user.id, action: 'knowledge_article.archive', entityType: 'knowledge_article', entityId: rows[0].id, metadata: { title: rows[0].title }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ archived: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
