'use strict';

const { query } = require('./db');

/**
 * Canonical org_id for the signed-in user from the database (avoids JWT/cache drift).
 */
async function orgIdForSessionUser(req) {
  const { rows } = await query(`SELECT org_id FROM users WHERE id = $1::uuid`, [req.user.id]);
  const fromDb = rows[0]?.org_id;
  if (fromDb != null && fromDb !== '') return String(fromDb);
  const fallback = req.user.org_id ?? req.user.orgId;
  return fallback != null && fallback !== '' ? String(fallback) : null;
}

module.exports = { orgIdForSessionUser };
