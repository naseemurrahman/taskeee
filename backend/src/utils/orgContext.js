'use strict';

const { query } = require('./db');

let userColumnSet = null;

async function getUserColumns() {
  if (userColumnSet) return userColumnSet;
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'`
  );
  userColumnSet = new Set(rows.map((r) => String(r.column_name)));
  return userColumnSet;
}

/**
 * Canonical org_id for the signed-in user from the database (avoids JWT/cache drift).
 * Supports legacy schemas where the users table may use organization_id instead of org_id.
 */
async function orgIdForSessionUser(req) {
  try {
    const cols = await getUserColumns();
    const dbOrgColumn = cols.has('org_id') ? 'org_id' : (cols.has('organization_id') ? 'organization_id' : null);

    if (dbOrgColumn) {
      const { rows } = await query(`SELECT ${dbOrgColumn} AS org_id FROM users WHERE id = $1`, [req.user.id]);
      const fromDb = rows[0]?.org_id;
      if (fromDb != null && fromDb !== '') return String(fromDb);
    }
  } catch (_err) {
    // Fall back to auth payload/session fields below.
  }

  const fallback = req.user.org_id ?? req.user.orgId ?? req.user.organization_id ?? req.user.organizationId;
  return fallback != null && fallback !== '' ? String(fallback) : null;
}

module.exports = { orgIdForSessionUser };
