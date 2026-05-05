const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { logUserActivity } = require('../services/activityService');
const { cacheDel } = require('../utils/redis');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null;
}

function deviceName(userAgent) {
  const ua = String(userAgent || 'Unknown device');
  if (/iPhone|iPad|Android/i.test(ua)) return 'Mobile browser';
  if (/Windows/i.test(ua)) return 'Windows browser';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac browser';
  if (/Linux/i.test(ua)) return 'Linux browser';
  return ua.slice(0, 80);
}

async function revokeByRefreshToken(req, userId) {
  const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'];
  if (!refreshToken) return { revoked: 0 };
  const tokenHash = hashToken(refreshToken);
  const { rowCount } = await query(
    `UPDATE refresh_tokens
        SET revoked = TRUE,
            revoked_at = COALESCE(revoked_at, NOW())
      WHERE user_id = $1 AND token_hash = $2 AND COALESCE(revoked, FALSE) = FALSE`,
    [userId, tokenHash]
  );
  return { revoked: rowCount };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT session_id,
              token_family_id,
              MIN(created_at) AS created_at,
              MAX(COALESCE(last_used_at, created_at)) AS last_used_at,
              MAX(expires_at) AS expires_at,
              BOOL_OR(COALESCE(revoked, FALSE)) AS has_revoked_token,
              BOOL_OR(COALESCE(reuse_detected_at IS NOT NULL, FALSE)) AS reuse_detected,
              MAX(ip_address) AS ip_address,
              MAX(user_agent) AS user_agent,
              MAX(device_name) AS device_name,
              COUNT(*)::int AS token_count
         FROM refresh_tokens
        WHERE user_id = $1
          AND expires_at > NOW()
        GROUP BY session_id, token_family_id
        ORDER BY MAX(COALESCE(last_used_at, created_at)) DESC NULLS LAST`,
      [req.user.id]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const result = await revokeByRefreshToken(req, req.user.id);
    await logUserActivity({ orgId: req.user.org_id, userId: req.user.id, activityType: 'logout', metadata: { revoked: result.revoked, ip: clientIp(req) } }).catch(() => null);
    res.json({ ok: true, revoked: result.revoked });
  } catch (err) { next(err); }
});

router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    const keepCurrent = req.body?.keepCurrent === true;
    let currentHash = null;
    if (keepCurrent && req.body?.refreshToken) currentHash = hashToken(req.body.refreshToken);
    const params = [req.user.id];
    let keepClause = '';
    if (currentHash) { params.push(currentHash); keepClause = `AND token_hash <> $${params.length}`; }
    const { rowCount } = await query(
      `UPDATE refresh_tokens
          SET revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND COALESCE(revoked, FALSE) = FALSE
          AND expires_at > NOW()
          ${keepClause}`,
      params
    );
    await cacheDel(`user:${req.user.id}`).catch(() => null);
    await logUserActivity({ orgId: req.user.org_id, userId: req.user.id, activityType: 'logout_all_sessions', metadata: { revoked: rowCount, keepCurrent, ip: clientIp(req) } }).catch(() => null);
    res.json({ ok: true, revoked: rowCount });
  } catch (err) { next(err); }
});

router.delete('/:sessionId', authenticate, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { rowCount } = await query(
      `UPDATE refresh_tokens
          SET revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND session_id = $2
          AND COALESCE(revoked, FALSE) = FALSE`,
      [req.user.id, sessionId]
    );
    await logUserActivity({ orgId: req.user.org_id, userId: req.user.id, activityType: 'session_revoked', metadata: { sessionId, revoked: rowCount } }).catch(() => null);
    res.json({ ok: true, revoked: rowCount });
  } catch (err) { next(err); }
});

router.delete('/admin/:userId/:sessionId', authenticate, requireAnyRole('admin', 'director'), async (req, res, next) => {
  try {
    const { rows: users } = await query(`SELECT id, org_id FROM users WHERE id = $1`, [req.params.userId]);
    const target = users[0];
    if (!target || String(target.org_id) !== String(req.user.org_id)) return res.status(404).json({ error: 'User not found' });
    const { rowCount } = await query(
      `UPDATE refresh_tokens
          SET revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE user_id = $1
          AND session_id = $2
          AND COALESCE(revoked, FALSE) = FALSE`,
      [req.params.userId, req.params.sessionId]
    );
    await logUserActivity({ orgId: req.user.org_id, userId: req.user.id, activityType: 'admin_session_revoked', metadata: { targetUserId: req.params.userId, sessionId: req.params.sessionId, revoked: rowCount } }).catch(() => null);
    res.json({ ok: true, revoked: rowCount });
  } catch (err) { next(err); }
});

module.exports = { router, hashToken, clientIp, deviceName };
